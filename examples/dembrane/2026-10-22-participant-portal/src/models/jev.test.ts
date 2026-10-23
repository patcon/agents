import { describe, expect, it } from "vitest";
import { assessmentRequest, type Assessable } from "./jev";

const tutorial: Assessable = {
  id: "tutorial",
  type: "radio",
  prompt: "Which tutorial should participants see first?",
  options: ["None", "Basic", "Advanced"]
};

type State = { transcript: { said: string }[]; questions: Record<string, { prompt: string }> };

describe("assessmentRequest", () => {
  it("gives Jev what was said with question marks as periods", () => {
    const request = assessmentRequest("jev-test", [tutorial], [
      { id: "u1", text: "Basic? Yes, basic?", onScreen: "tutorial" }
    ]);

    const state = request.state as State;
    expect(state.transcript[0].said).toBe("Basic. Yes, basic.");
  });

  it("drops Spanish's opening question mark", () => {
    const request = assessmentRequest("jev-test", [tutorial], [
      { id: "u1", text: "¿Básico?", onScreen: "tutorial" }
    ]);

    const state = request.state as State;
    expect(state.transcript[0].said).toBe("Básico.");
  });

  it("leaves the question's own prompt as it is", () => {
    const request = assessmentRequest("jev-test", [tutorial], []);

    const state = request.state as State;
    expect(state.questions.q1.prompt).toBe(
      "Which tutorial should participants see first?"
    );
  });
});
