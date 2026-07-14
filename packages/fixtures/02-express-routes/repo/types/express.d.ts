declare module "express" {
  export interface Request {
    params: Record<string, string>;
    body: unknown;
  }
  export interface Response {
    json(value: unknown): unknown;
  }
  export type Handler = (req: Request, res: Response) => unknown;
  export interface RouterInstance {
    get(path: string, handler: Handler): void;
    post(path: string, handler: Handler): void;
  }
  export function Router(): RouterInstance;
  export default function express(): {
    use(path: string, router: RouterInstance): void;
  };
}
