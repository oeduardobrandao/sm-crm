import type { AIOutput, ReportData, Recommendation, SuggestedGoal } from "./types.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AIPrompt {
  systemPrompt: string;
  userPrompt: string;
}

export type ValidateResult =
  | { valid: true; output: AIOutput }
  | { valid: false; error: string };

export type GenerateResult =
  | { output: AIOutput; status: "success" }
  | { output: null; status: "validation_failed" | "generation_failed"; error: string };

// ---------------------------------------------------------------------------
// buildAIPrompt
// ---------------------------------------------------------------------------

export function buildAIPrompt(data: ReportData): AIPrompt {
  const systemPrompt = `You are a social media analytics specialist writing a monthly performance report for a client of a Brazilian social media agency.

LANGUAGE: Write entirely in Brazilian Portuguese (pt-BR). All text, including labels and section headers, must be in pt-BR.

DATA RULES:
- ONLY use numbers from the provided data — never invent or estimate numbers.
- Use the client's @handle, never their real name.
- Be analytical, not promotional — connect data to insights.
- When a metric improves: explain what likely caused it.
- When a metric declines: explain the context without being alarming.
- Compare to previous period only when delta data is provided.
- Never reference industry benchmarks unless explicitly provided in the data.
- Keep tone professional but accessible — the client may not be a marketer.

OUTPUT FORMAT: Respond with ONLY valid JSON matching this exact structure:
{
  "executive_summary": "2-3 sentences summarizing the month",
  "detailed_analysis": "2-3 paragraphs with in-depth analysis",
  "recommendations": [
    {
      "title": "Short action title",
      "description": "Why and how to act on this",
      "priority": "high|medium|low",
      "based_on_metric": "metric_id from the provided data"
    }
  ],
  "suggested_goals": [
    {
      "metric": "metric_id from the provided data",
      "target": "Specific target value",
      "rationale": "Why this target makes sense"
    }
  ]
}

Provide exactly 3-5 recommendations and 2-3 suggested_goals.`;

  const userPrompt = `Analyze the following Instagram account data for ${data.handle} (${data.specialty}), period ${data.period}:

${JSON.stringify(data, null, 2)}`;

  return { systemPrompt, userPrompt };
}

// ---------------------------------------------------------------------------
// validateAIOutput
// ---------------------------------------------------------------------------

export function validateAIOutput(raw: unknown): ValidateResult {
  if (typeof raw !== "object" || raw === null) {
    return { valid: false, error: "Output is not an object" };
  }

  const obj = raw as Record<string, unknown>;

  // Check required top-level fields exist
  const requiredFields = ["executive_summary", "detailed_analysis", "recommendations", "suggested_goals"];
  for (const field of requiredFields) {
    if (!(field in obj)) {
      return { valid: false, error: `Missing required field: ${field}` };
    }
  }

  // executive_summary: string, 50-500 chars
  if (typeof obj.executive_summary !== "string") {
    return { valid: false, error: "executive_summary must be a string" };
  }
  if (obj.executive_summary.length < 50 || obj.executive_summary.length > 500) {
    return {
      valid: false,
      error: `executive_summary must be 50-500 chars, got ${obj.executive_summary.length}`,
    };
  }

  // detailed_analysis: string, 200-3000 chars
  if (typeof obj.detailed_analysis !== "string") {
    return { valid: false, error: "detailed_analysis must be a string" };
  }
  if (obj.detailed_analysis.length < 150 || obj.detailed_analysis.length > 3000) {
    return {
      valid: false,
      error: `detailed_analysis must be 150-3000 chars, got ${obj.detailed_analysis.length}`,
    };
  }

  // recommendations: array of 3-5 items
  if (!Array.isArray(obj.recommendations)) {
    return { valid: false, error: "recommendations must be an array" };
  }
  if (obj.recommendations.length < 3 || obj.recommendations.length > 5) {
    return {
      valid: false,
      error: `recommendations must have 3-5 items, got ${obj.recommendations.length}`,
    };
  }
  for (let i = 0; i < obj.recommendations.length; i++) {
    const rec = obj.recommendations[i] as Record<string, unknown>;
    if (typeof rec !== "object" || rec === null) {
      return { valid: false, error: `recommendations[${i}] must be an object` };
    }
    if (typeof rec.title !== "string" || rec.title.length === 0) {
      return { valid: false, error: `recommendations[${i}].title must be a non-empty string` };
    }
    if (typeof rec.description !== "string" || rec.description.length === 0) {
      return { valid: false, error: `recommendations[${i}].description must be a non-empty string` };
    }
    if (!["high", "medium", "low"].includes(rec.priority as string)) {
      return { valid: false, error: `recommendations[${i}].priority must be high, medium, or low` };
    }
    if (rec.based_on_metric !== undefined && typeof rec.based_on_metric !== "string") {
      return { valid: false, error: `recommendations[${i}].based_on_metric must be a string` };
    }
  }

  // suggested_goals: array of 2-3 items
  if (!Array.isArray(obj.suggested_goals)) {
    return { valid: false, error: "suggested_goals must be an array" };
  }
  if (obj.suggested_goals.length < 2 || obj.suggested_goals.length > 3) {
    return {
      valid: false,
      error: `suggested_goals must have 2-3 items, got ${obj.suggested_goals.length}`,
    };
  }
  for (let i = 0; i < obj.suggested_goals.length; i++) {
    const goal = obj.suggested_goals[i] as Record<string, unknown>;
    if (typeof goal !== "object" || goal === null) {
      return { valid: false, error: `suggested_goals[${i}] must be an object` };
    }
    if (typeof goal.metric !== "string" || goal.metric.length === 0) {
      return { valid: false, error: `suggested_goals[${i}].metric must be a non-empty string` };
    }
    if (typeof goal.target !== "string" || goal.target.length === 0) {
      return { valid: false, error: `suggested_goals[${i}].target must be a non-empty string` };
    }
    if (typeof goal.rationale !== "string" || goal.rationale.length === 0) {
      return { valid: false, error: `suggested_goals[${i}].rationale must be a non-empty string` };
    }
  }

  // All checks passed — cast to AIOutput
  const output: AIOutput = {
    executive_summary: obj.executive_summary as string,
    detailed_analysis: obj.detailed_analysis as string,
    recommendations: obj.recommendations as Recommendation[],
    suggested_goals: obj.suggested_goals as SuggestedGoal[],
  };

  return { valid: true, output };
}

// ---------------------------------------------------------------------------
// generateAINarrative
// ---------------------------------------------------------------------------

export async function generateAINarrative(
  data: ReportData,
  apiKey: string,
): Promise<GenerateResult> {
  const { systemPrompt, userPrompt } = buildAIPrompt(data);

  const MAX_RETRIES = 2;
  let response: Response | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: userPrompt }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.3,
            },
          }),
        },
      );
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        return {
          output: null,
          status: "generation_failed",
          error: `Network error calling Gemini API: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }

    if (response.status === 429 && attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
      continue;
    }
    break;
  }

  if (!response!.ok) {
    const body = await response!.text().catch(() => "(unreadable)");
    return {
      output: null,
      status: "generation_failed",
      error: `Gemini API returned HTTP ${response!.status}: ${body.slice(0, 200)}`,
    };
  }

  let responseBody: unknown;
  try {
    responseBody = await response!.json();
  } catch (err) {
    return {
      output: null,
      status: "generation_failed",
      error: `Failed to parse Gemini API response as JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Extract text from Gemini response structure
  let rawText: string;
  try {
    const body = responseBody as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    rawText = body.candidates[0].content.parts[0].text;
  } catch {
    return {
      output: null,
      status: "generation_failed",
      error: "Unexpected Gemini API response structure",
    };
  }

  // Parse the JSON text returned by the model
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    return {
      output: null,
      status: "generation_failed",
      error: `Model did not return valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Validate the parsed output
  const validation = validateAIOutput(parsed);
  if (!validation.valid) {
    return {
      output: null,
      status: "validation_failed",
      error: validation.error,
    };
  }

  return { output: validation.output, status: "success" };
}
