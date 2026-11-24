import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Infrastructure packages that own models/utilities but intentionally do not
// install a standalone addon. Keep this list explicit and minimal.
const NON_ADDON_PACKAGES = new Set(['orm-automation-core', 'orm-cli']);

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function listTsFilesRecursive(dir) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => compareText(a.name, b.name))) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listTsFilesRecursive(full)));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      files.push(full);
    }
  }
  return files;
}

function getPropertyAssignment(objectNode, propName) {
  if (!objectNode || !ts.isObjectLiteralExpression(objectNode)) return undefined;
  for (const prop of objectNode.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) &&
      prop.name.text === propName
    ) {
      return prop.initializer;
    }
    if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === propName) {
      return prop.name;
    }
  }
  return undefined;
}

function extractStringLiteral(node) {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return undefined;
}

function extractBooleanLiteral(node) {
  if (!node) return undefined;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

function extractStringArray(node, constMap = new Map()) {
  if (!node) return undefined;
  if (ts.isIdentifier(node) && constMap.has(node.text)) {
    return constMap.get(node.text);
  }
  if (ts.isAsExpression(node)) {
    return extractStringArray(node.expression, constMap);
  }
  if (ts.isArrayLiteralExpression(node)) {
    const values = [];
    for (const elem of node.elements) {
      const str = extractStringLiteral(elem);
      if (str !== undefined) values.push(str);
    }
    return values;
  }
  return undefined;
}

function extractTargetSymbolName(node) {
  if (!node) return undefined;
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    if (ts.isIdentifier(node.body)) return node.body.text;
    if (ts.isBlock(node.body)) {
      for (const stmt of node.body.statements) {
        if (ts.isReturnStatement(stmt) && stmt.expression && ts.isIdentifier(stmt.expression)) {
          return stmt.expression.text;
        }
      }
    }
  }
  if (ts.isCallExpression(node) && node.arguments.length > 0) {
    return extractTargetSymbolName(node.arguments[0]);
  }
  return undefined;
}

function collectConstStringArrays(sourceFile) {
  const constMap = new Map();
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const arr = extractStringArray(node.initializer);
      if (arr && arr.length > 0) {
        constMap.set(node.name.text, arr);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return constMap;
}

/** Resolve `const x = { ... }` field maps referenced as `fields: x`. */
function collectConstObjectLiterals(sourceFile) {
  const constMap = new Map();
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      constMap.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return constMap;
}

function parseFieldInitializer(fieldName, callNode, constMap) {
  if (!ts.isCallExpression(callNode)) return null;
  let kind = null;
  if (
    ts.isPropertyAccessExpression(callNode.expression) &&
    ts.isIdentifier(callNode.expression.expression) &&
    callNode.expression.expression.text === 'fields'
  ) {
    kind = callNode.expression.name.text;
  } else if (ts.isIdentifier(callNode.expression)) {
    kind = callNode.expression.text;
  }
  if (!kind) return null;

  let optionsObj = null;
  let enumValues = undefined;
  let targetSymbol = undefined;

  if (kind === 'enum') {
    enumValues = extractStringArray(callNode.arguments[0], constMap);
    if (callNode.arguments[1] && ts.isObjectLiteralExpression(callNode.arguments[1])) {
      optionsObj = callNode.arguments[1];
    }
  } else if (kind === 'belongsTo' || kind === 'hasMany') {
    targetSymbol = extractTargetSymbolName(callNode.arguments[0]);
    if (callNode.arguments[1] && ts.isObjectLiteralExpression(callNode.arguments[1])) {
      optionsObj = callNode.arguments[1];
    }
  } else if (callNode.arguments[0] && ts.isObjectLiteralExpression(callNode.arguments[0])) {
    optionsObj = callNode.arguments[0];
  }

  const required = extractBooleanLiteral(getPropertyAssignment(optionsObj, 'required')) === true;
  const unique = extractBooleanLiteral(getPropertyAssignment(optionsObj, 'unique')) === true;
  const hasDefault = getPropertyAssignment(optionsObj, 'default') !== undefined;
  const label = extractStringLiteral(getPropertyAssignment(optionsObj, 'label'));
  const pattern = extractStringLiteral(getPropertyAssignment(optionsObj, 'pattern'));
  const foreignKey = extractStringLiteral(getPropertyAssignment(optionsObj, 'foreignKey'));

  return {
    name: fieldName,
    kind,
    column: kind === 'belongsTo' ? (foreignKey ?? `${fieldName}_id`) : fieldName,
    required: required && !hasDefault,
    declaredRequired: required,
    unique,
    hasDefault,
    ...(label ? { label } : {}),
    ...(pattern ? { pattern } : {}),
    ...(enumValues && enumValues.length > 0 ? { values: [...enumValues].sort(compareText) } : {}),
    ...(targetSymbol ? { targetSymbol } : {}),
    ...(foreignKey ? { foreignKey } : {}),
  };
}

/**
 * Statically parses a TypeScript source file for `defineModel` and `defineAddon` declarations
 * without executing runtime database or native sidecar dependencies.
 */
export function parseOrmSourceFile(
  sourceText,
  relativeFilePath = 'model.ts',
  sharedConstMap = new Map()
) {
  const sourceFile = ts.createSourceFile(
    relativeFilePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const localConsts = collectConstStringArrays(sourceFile);
  const mergedConsts = new Map([...sharedConstMap.entries(), ...localConsts.entries()]);
  const objectConsts = collectConstObjectLiterals(sourceFile);

  const models = [];
  const addons = [];
  const errors = [];

  const inspectCall = (callNode, assignedVarName = null) => {
    if (!ts.isCallExpression(callNode)) return;
    const calleeName = ts.isIdentifier(callNode.expression)
      ? callNode.expression.text
      : ts.isPropertyAccessExpression(callNode.expression)
        ? callNode.expression.name.text
        : null;

    if (calleeName === 'defineModel') {
      let modelName = extractStringLiteral(callNode.arguments[0]);
      let specObj =
        callNode.arguments[1] && ts.isObjectLiteralExpression(callNode.arguments[1])
          ? callNode.arguments[1]
          : null;

      if (
        !modelName &&
        callNode.arguments[0] &&
        ts.isObjectLiteralExpression(callNode.arguments[0])
      ) {
        specObj = callNode.arguments[0];
        modelName = extractStringLiteral(getPropertyAssignment(specObj, 'name'));
      }

      if (!modelName) {
        errors.push(`${relativeFilePath}: defineModel call is missing a static literal modelName`);
        return;
      }

      const tableName =
        extractStringLiteral(getPropertyAssignment(specObj, 'table')) ??
        modelName.replaceAll('.', '_');
      const order = extractStringLiteral(getPropertyAssignment(specObj, 'order'));
      let fieldsObj = getPropertyAssignment(specObj, 'fields');
      if (fieldsObj && ts.isIdentifier(fieldsObj)) {
        fieldsObj = objectConsts.get(fieldsObj.text) ?? fieldsObj;
      }
      const parsedFields = [];

      if (fieldsObj && ts.isObjectLiteralExpression(fieldsObj)) {
        for (const prop of fieldsObj.properties) {
          if (
            ts.isPropertyAssignment(prop) &&
            (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))
          ) {
            const parsedField = parseFieldInitializer(
              prop.name.text,
              prop.initializer,
              mergedConsts
            );
            if (parsedField) {
              parsedFields.push(parsedField);
            } else {
              errors.push(
                `${relativeFilePath}: Model '${modelName}' field '${prop.name.text}' has unsupported initializer`
              );
            }
          }
        }
      } else {
        errors.push(`${relativeFilePath}: Model '${modelName}' is missing a static fields object`);
      }

      parsedFields.sort((a, b) => compareText(a.name, b.name));
      models.push({
        symbolName: assignedVarName,
        modelName,
        tableName,
        ...(order ? { order } : {}),
        file: relativeFilePath.replaceAll('\\', '/'),
        fields: parsedFields,
      });
    } else if (calleeName === 'defineAddon') {
      const specObj =
        callNode.arguments[0] && ts.isObjectLiteralExpression(callNode.arguments[0])
          ? callNode.arguments[0]
          : null;
      const addonName = extractStringLiteral(getPropertyAssignment(specObj, 'name'));
      const version = extractStringLiteral(getPropertyAssignment(specObj, 'version')) ?? '1.0.0';
      const depends =
        extractStringArray(getPropertyAssignment(specObj, 'depends'), mergedConsts) ?? [];
      const modelsNode = getPropertyAssignment(specObj, 'models');
      const modelSymbols = [];
      if (modelsNode && ts.isArrayLiteralExpression(modelsNode)) {
        for (const elem of modelsNode.elements) {
          if (ts.isIdentifier(elem)) modelSymbols.push(elem.text);
        }
      }

      if (!addonName) {
        errors.push(`${relativeFilePath}: defineAddon call is missing a static literal name`);
        return;
      }

      addons.push({
        name: addonName,
        version,
        depends: [...depends].sort(compareText),
        modelSymbols,
        file: relativeFilePath.replaceAll('\\', '/'),
      });
    }
  };

  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    ) {
      const varName = ts.isIdentifier(node.name) ? node.name.text : null;
      inspectCall(node.initializer, varName);
    } else if (ts.isCallExpression(node)) {
      // Avoid double-visiting variable declaration initializer
      if (
        !node.parent ||
        !ts.isVariableDeclaration(node.parent) ||
        node.parent.initializer !== node
      ) {
        inspectCall(node, null);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { models, addons, errors, constMap: localConsts };
}

function fieldToOpenApiProperty(field) {
  switch (field.kind) {
    case 'integer':
      return { type: 'integer' };
    case 'boolean':
      return { type: 'boolean' };
    case 'belongsTo':
      return {
        type: 'integer',
        description: field.relation
          ? `Foreign key ID referencing ${field.relation}`
          : 'Foreign key ID',
      };
    case 'hasMany':
      return {
        type: 'array',
        items: { type: 'integer' },
        description: field.relation
          ? `Related record IDs for ${field.relation}`
          : 'Related record IDs',
      };
    case 'enum':
      return {
        type: 'string',
        ...(field.values && field.values.length > 0 ? { enum: field.values } : {}),
      };
    case 'password':
      return {
        type: 'string',
        format: 'password',
        writeOnly: true,
      };
    case 'text':
    case 'string':
    default:
      return {
        type: 'string',
        ...(field.pattern ? { pattern: field.pattern } : {}),
      };
  }
}

/**
 * Compiles the normalized model catalog into a deterministic OpenAPI 3.1.0 specification.
 */
export function buildOpenApi31Spec(models, rootVersion = '1.0.0-rc.1') {
  const schemas = {};
  const paths = {};

  for (const model of [...models].sort((a, b) => compareText(a.modelName, b.modelName))) {
    const schemaKey = model.modelName.replaceAll('.', '_');
    const properties = {
      id: { type: 'integer', readOnly: true },
    };
    const requiredFields = ['id'];

    for (const field of model.fields) {
      properties[field.name] = fieldToOpenApiProperty(field);
      if (field.required) {
        requiredFields.push(field.name);
      }
    }

    schemas[schemaKey] = {
      type: 'object',
      title: model.modelName,
      'x-moonwitness-model': model.modelName,
      'x-moonwitness-table': model.tableName,
      'x-moonwitness-addon': model.addon,
      required: [...new Set(requiredFields)].sort(compareText),
      properties,
      additionalProperties: false,
    };

    const collectionPath = `/api/models/${model.modelName}`;
    const itemPath = `/api/models/${model.modelName}/{id}`;

    paths[collectionPath] = {
      get: {
        operationId: `list_${schemaKey}`,
        summary: `List ${model.modelName} records`,
        responses: {
          200: {
            description: `Array of ${model.modelName} records`,
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: `#/components/schemas/${schemaKey}` },
                },
              },
            },
          },
        },
      },
      post: {
        operationId: `create_${schemaKey}`,
        summary: `Create a ${model.modelName} record`,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: `#/components/schemas/${schemaKey}` },
            },
          },
        },
        responses: {
          201: {
            description: `Created ${model.modelName} record`,
            content: {
              'application/json': {
                schema: { $ref: `#/components/schemas/${schemaKey}` },
              },
            },
          },
        },
      },
    };

    paths[itemPath] = {
      get: {
        operationId: `get_${schemaKey}`,
        summary: `Retrieve a ${model.modelName} record by ID`,
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'integer' },
          },
        ],
        responses: {
          200: {
            description: `${model.modelName} record`,
            content: {
              'application/json': {
                schema: { $ref: `#/components/schemas/${schemaKey}` },
              },
            },
          },
        },
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'MoonWitness ORM Metadata-Driven API',
      version: rootVersion,
      description:
        'Deterministic OpenAPI 3.1 schema compiled from @moonwitness/orm-* model metadata.',
    },
    paths,
    components: {
      schemas,
    },
  };
}

/**
 * Introspects `packages/orm-*` (and optional additional addon packages) statically to produce
 * a deterministic model/addon inventory and OpenAPI 3.1 schema.
 */
export async function compileWorkspaceOrmCodegen(options = {}) {
  const workspaceRoot = options.workspaceRoot ? path.resolve(options.workspaceRoot) : defaultRoot;
  const packagesDir = path.join(workspaceRoot, 'packages');
  if (!existsSync(packagesDir)) {
    throw new Error(`Workspace packages directory not found at '${packagesDir}'`);
  }

  let rootVersion = '1.0.0-rc.1';
  const rootPkgPath = path.join(workspaceRoot, 'package.json');
  if (existsSync(rootPkgPath)) {
    try {
      const rootPkg = JSON.parse(await readFile(rootPkgPath, 'utf8'));
      if (typeof rootPkg.version === 'string') rootVersion = rootPkg.version;
    } catch {
      // keep default version
    }
  }

  const entries = await readdir(packagesDir, { withFileTypes: true });
  const ormPackageDirs = [];

  for (const entry of entries.sort((a, b) => compareText(a.name, b.name))) {
    if (!entry.isDirectory()) continue;
    const pkgDir = path.join(packagesDir, entry.name);
    const pkgJsonPath = path.join(pkgDir, 'package.json');
    if (!existsSync(pkgJsonPath)) continue;
    let pkgJson;
    try {
      pkgJson = JSON.parse(await readFile(pkgJsonPath, 'utf8'));
    } catch {
      continue;
    }
    if (entry.name.startsWith('orm-') || pkgJson.moonwitnessAddon) {
      ormPackageDirs.push({ dirName: entry.name, pkgDir, pkgJson });
    }
  }

  const allModels = [];
  const allAddons = [];
  const validationErrors = [];
  const symbolToModelName = new Map();

  for (const { dirName, pkgDir, pkgJson } of ormPackageDirs) {
    const srcDir = path.join(pkgDir, 'src');
    const tsFiles = await listTsFilesRecursive(srcDir);
    const pkgConstMap = new Map();

    // First pass: collect shared constants across files in the package
    for (const file of tsFiles) {
      const content = await readFile(file, 'utf8');
      const sf = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      for (const [k, v] of collectConstStringArrays(sf).entries()) {
        pkgConstMap.set(k, v);
      }
    }

    const pkgModels = [];
    const pkgAddons = [];

    for (const file of tsFiles) {
      const relPath = path.relative(workspaceRoot, file).replaceAll('\\', '/');
      const content = await readFile(file, 'utf8');
      const parsed = parseOrmSourceFile(content, relPath, pkgConstMap);
      validationErrors.push(...parsed.errors);
      for (const m of parsed.models) {
        if (m.symbolName) symbolToModelName.set(m.symbolName, m.modelName);
        pkgModels.push(m);
      }
      pkgAddons.push(...parsed.addons);
    }

    const fallbackAddonName = pkgJson.moonwitnessAddon?.name ?? dirName.replace(/^orm-/u, '');
    const declaredAddon = pkgAddons[0] ?? {
      name: fallbackAddonName,
      version: pkgJson.version ?? '1.0.0',
      depends: [],
      modelSymbols: pkgModels.map((m) => m.symbolName).filter(Boolean),
      file: `${path.relative(workspaceRoot, pkgDir).replaceAll('\\', '/')}/package.json`,
    };

    if (pkgAddons.length === 0 && !NON_ADDON_PACKAGES.has(dirName)) {
      validationErrors.push(
        `Package '${pkgJson.name}' under 'packages/${dirName}' does not declare defineAddon(...)`
      );
    }

    for (const m of pkgModels) {
      allModels.push({
        ...m,
        addon: declaredAddon.name,
        packageName: pkgJson.name,
      });
    }

    allAddons.push({
      addon: declaredAddon.name,
      packageName: pkgJson.name,
      version: declaredAddon.version,
      depends: declaredAddon.depends,
      models: pkgModels.map((m) => m.modelName).sort(compareText),
      file: declaredAddon.file,
    });
  }

  // Resolve relation target symbols to canonical modelName strings
  for (const model of allModels) {
    for (const field of model.fields) {
      if (field.targetSymbol) {
        const resolved = symbolToModelName.get(field.targetSymbol);
        if (resolved) {
          field.relation = resolved;
        }
        delete field.targetSymbol;
      }
    }
    delete model.symbolName;
  }

  allModels.sort((a, b) => compareText(a.modelName, b.modelName));
  allAddons.sort((a, b) => compareText(a.addon, b.addon));

  // Validate uniqueness & non-empty inventory
  if (allAddons.length === 0) {
    validationErrors.push('No ORM addons discovered under packages/orm-*');
  }
  if (allModels.length === 0) {
    validationErrors.push('No ORM models discovered under packages/orm-*');
  }

  const seenModelNames = new Set();
  const seenTableNames = new Set();
  for (const model of allModels) {
    if (seenModelNames.has(model.modelName)) {
      validationErrors.push(`Duplicate ORM model name '${model.modelName}'`);
    }
    seenModelNames.add(model.modelName);

    if (seenTableNames.has(model.tableName)) {
      validationErrors.push(`Duplicate ORM table name '${model.tableName}'`);
    }
    seenTableNames.add(model.tableName);
  }

  const openApi = buildOpenApi31Spec(allModels, rootVersion);
  const openApiSha256 = createHash('sha256').update(JSON.stringify(openApi)).digest('hex');
  const inventorySha256 = createHash('sha256')
    .update(JSON.stringify({ addons: allAddons, models: allModels }))
    .digest('hex');

  const fieldCount = allModels.reduce((sum, m) => sum + m.fields.length, 0);

  const report = {
    format: 'moonwitness-orm-codegen/v1',
    passed: validationErrors.length === 0,
    addonCount: allAddons.length,
    modelCount: allModels.length,
    fieldCount,
    openApiVersion: openApi.openapi,
    openApiPathCount: Object.keys(openApi.paths).length,
    openApiSchemaCount: Object.keys(openApi.components.schemas).length,
    inventorySha256,
    openApiSha256,
    errors: validationErrors,
    addons: allAddons,
    models: allModels,
    openApi,
  };

  if (options.out) {
    const outPath = path.resolve(options.out);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  if (options.check && !report.passed) {
    throw new Error(
      `ORM codegen check failed with ${validationErrors.length} error(s):\n${validationErrors
        .map((e) => `- ${e}`)
        .join('\n')}`
    );
  }

  return report;
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const check = args.includes('--check');
  const includeFull = args.includes('--full');
  const outIdx = args.indexOf('--out');
  const out = outIdx >= 0 ? args[outIdx + 1] : undefined;

  const report = await compileWorkspaceOrmCodegen({ check: false, out });

  if (asJson) {
    const payload = includeFull
      ? report
      : {
          format: report.format,
          passed: report.passed,
          addonCount: report.addonCount,
          modelCount: report.modelCount,
          fieldCount: report.fieldCount,
          openApiVersion: report.openApiVersion,
          openApiPathCount: report.openApiPathCount,
          openApiSchemaCount: report.openApiSchemaCount,
          inventorySha256: report.inventorySha256,
          openApiSha256: report.openApiSha256,
          errors: report.errors,
          addons: report.addons,
        };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(
      `MoonWitness ORM Codegen: ${report.passed ? 'PASSED' : 'FAILED'} · ${report.addonCount} addons · ${report.modelCount} models · ${report.fieldCount} fields · OpenAPI ${report.openApiVersion} (${report.openApiSchemaCount} schemas, sha256=${report.openApiSha256.slice(0, 12)})\n`
    );
    for (const err of report.errors) {
      process.stderr.write(`  - ${err}\n`);
    }
  }

  if (check && !report.passed) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
