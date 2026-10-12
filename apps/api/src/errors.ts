import type { ApiErrorBody } from '@translator/shared';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

type Code = ApiErrorBody['error']['code'];

/** An error that is safe to show to the client. Anything else becomes a generic 500. */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: Code,
    message: string,
  ) {
    super(message);
  }

  toBody(): ApiErrorBody {
    return { error: { code: this.code, message: this.message } };
  }
}
