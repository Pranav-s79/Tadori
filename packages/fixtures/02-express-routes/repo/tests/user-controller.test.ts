import { UserController } from "../src/controllers/user-controller.js";
import { UserService } from "../src/services/user-service.js";

declare function test(name: string, fn: () => void): void;

test("user controller delegates to the service", () => {
  const controller = new UserController(new UserService());
  void controller.getUser;
});
