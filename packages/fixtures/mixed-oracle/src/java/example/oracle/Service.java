package example.oracle;

import java.lang.reflect.Method;

// Java named record, method, static function, and reflective unresolved call.
public final class Service {
  public record Payload(int value) {
    public String label() { return "java:" + value; }
  }

  public static int transform(int value) { return value + 1; }

  public static Object unresolved(Object target, String name) throws Exception {
    Method method = target.getClass().getMethod(name);
    return method.invoke(target);
  }
}
