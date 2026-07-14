import { AdminController } from "./controllers/admin-controller.js";
import { UserController } from "./controllers/user-controller.js";
import { AuditService } from "./services/audit-service.js";
import { UserService } from "./services/user-service.js";

export function makeUserController(): UserController {
  return new UserController(new UserService());
}

export function makeAdminController(): AdminController {
  return new AdminController(new AuditService());
}
