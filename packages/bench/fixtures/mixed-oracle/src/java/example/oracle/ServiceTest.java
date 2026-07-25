package example.oracle;

// Framework-shaped Java test method and calls.
public final class ServiceTest {
  public void testTransform() {
    assert Service.transform(1) == 2;
    assert new Service.Payload(1).label().equals("java:1");
  }
}
