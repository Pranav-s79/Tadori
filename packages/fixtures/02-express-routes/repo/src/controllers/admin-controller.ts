import type { Request, Response } from "express";
import { AuditService } from "../services/audit-service.js";

export class AdminController {
  constructor(private readonly audit: AuditService) {}

  createAdmin = (_req: Request, res: Response): unknown => {
    this.audit.record("admin-created");
    return res.json({ ok: true });
  };
}
