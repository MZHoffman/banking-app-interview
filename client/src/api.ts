export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    requestId?: string;
  };
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({
      error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." },
    }))) as ApiErrorBody;
    throw new ApiError(res.status, body.error.code, body.error.message, body.error.fields);
  }

  return res;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await request(path, init);
  if (res.status === 204) {
    throw new ApiError(res.status, "EMPTY_RESPONSE", "Something went wrong. Please try again.");
  }
  return (await res.json()) as T;
}

export async function apiNoContent(path: string, init?: RequestInit): Promise<void> {
  await request(path, init);
}

export function isSessionError(error: unknown): boolean {
  return error instanceof ApiError && ["SESSION_EXPIRED", "AUTHENTICATION_REQUIRED"].includes(error.code);
}
