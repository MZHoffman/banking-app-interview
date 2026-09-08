declare global {
  namespace Express {
    interface Request {
      requestId: string;
      authenticatedUser?: {
        id: string;
        firstName: string;
        lastName: string;
      };
      sessionId?: string;
    }
  }
}

export {};
