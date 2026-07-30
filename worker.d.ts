export declare class IsrArtifact {
  fetch(request: Request): Promise<Response>;
}

declare const worker: {
  fetch(request: Request, env: unknown, context: unknown): Promise<Response>;
};

export default worker;
