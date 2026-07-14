import type { Request, Response } from "express";
import { unsafeLookup } from "../infra/db.js";
import { UserService } from "../services/user-service.js";

export class UserController {
  constructor(private readonly users: UserService) {}

  getUser = (req: Request, res: Response): unknown => {
    const viaService = this.users.getUser(req.params.id);
    const viaInfra = unsafeLookup(req.params.id);
    return res.json({ viaService, viaInfra });
  };
}
