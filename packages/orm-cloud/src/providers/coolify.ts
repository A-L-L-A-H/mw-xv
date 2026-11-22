export interface CoolifyDeployParams {
  readonly endpoint: string;
  readonly token: string;
  readonly appUuid: string;
  readonly fetchImpl?: typeof fetch;
}

export interface CoolifyDeployResult {
  readonly deploymentUuid?: string;
  readonly message: string;
}

export async function deployViaCoolify(params: CoolifyDeployParams): Promise<CoolifyDeployResult> {
  const fetchImpl = params.fetchImpl ?? globalThis.fetch;
  const baseUrl = params.endpoint.replace(/\/+$/u, '');
  const response = await fetchImpl(
    `${baseUrl}/api/v1/deploy?uuid=${encodeURIComponent(params.appUuid)}&force=true`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${params.token}`,
        'content-type': 'application/json',
      },
      signal: AbortSignal.timeout(30_000),
    }
  );

  if (!response.ok) {
    throw new Error(`Coolify deploy failed (${response.status})`);
  }

  const payload = (await response.json()) as { deployment_uuid?: string; message?: string };
  return {
    deploymentUuid: payload.deployment_uuid,
    message: payload.message ?? 'Deployment triggered',
  };
}
