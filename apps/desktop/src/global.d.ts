export {};

declare global {
  interface Window {
    readonly hypir: {
      connectRecovery(connection: {
        endpoint: string;
        token: string;
      }): Promise<{ endpoint: string; token: '' }>;
      connect(connection: { endpoint: string; token: string }): Promise<{
        endpoint: string;
        token: '';
      }>;
    };
  }
}
