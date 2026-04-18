export function assert(condition: unknown, message = "Assertion failed"): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertEquals<T>(actual: T, expected: T, message?: string) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(message ?? `Expected ${expectedJson} but received ${actualJson}`);
  }
}

export async function readJson(response: Response) {
  return await response.json();
}
