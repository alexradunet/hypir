export {};

declare global {
  interface Window {
    readonly hypir: {
      connect(connection: { endpoint: string; token: string }): Promise<{
        endpoint: string;
        token: '';
      }>;
    };
  }
}
