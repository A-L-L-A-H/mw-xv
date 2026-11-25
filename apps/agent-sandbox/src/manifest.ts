import { sha256Hex } from '@moonwitness/types/node';
import type { EphemeralSandboxManifest } from './contract.js';

/**
 * Local equivalent of ai-runtime's buildEphemeralSandboxManifest. The sidecar
 * cannot import runtime code from outside its own Docker context, so it builds
 * the same deterministic, hashed manifest here. Tests assert parity with the
 * shared builder.
 */
export function buildWorkspaceManifest(params: {
  readonly runId: string;
  readonly imageRef: string;
  readonly cpuCores: number;
  readonly memoryMb: number;
  readonly timeoutMs: number;
}): EphemeralSandboxManifest {
  const core: Omit<EphemeralSandboxManifest, 'manifestSha256'> = {
    runId: params.runId,
    engine: 'docker',
    imageRef: params.imageRef,
    command: ['/bin/sh', '-c', 'exec sleep 2147483647'],
    networkDisabled: true,
    readOnlyRootFs: true,
    secretsInjected: false,
    droppedCapabilities: ['ALL'],
    cpuCores: params.cpuCores,
    memoryMb: params.memoryMb,
    timeoutMs: params.timeoutMs,
    cliArgs: [
      'run',
      '--rm',
      '--network=none',
      '--read-only',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges:true',
      `--cpus=${String(params.cpuCores)}`,
      `--memory=${String(params.memoryMb)}m`,
      params.imageRef,
    ],
    sanitizedEnvKeys: [],
    automatedPromotionAllowed: false,
    automatedSelfMerge: false,
  };
  const manifestSha256 = sha256Hex(JSON.stringify(core));
  return { ...core, manifestSha256 };
}
