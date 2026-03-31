/**
 * OpenAI Image Generation wrapper for character and furniture asset creation.
 */

const CHARACTER_PROMPT_TEMPLATE = `
A cute 2.5D illustration of a {animal} character named {name},
working as a {role} in a cozy woodland office.
Style: soft lines, warm colors, large expressive eyes, chibi proportions.
The character is {state_description}.
Background: transparent or simple wooden desk.
Aspect ratio: 1:1, 512x512px.
`.trim();

const FURNITURE_PROMPT_TEMPLATE = `
A {furniture_type} for a cozy woodland animal office.
Style: warm wood tones, pastel accents, 2.5D isometric view.
Simple, clean design suitable for a pixel-art-inspired UI.
Background: transparent.
Aspect ratio: 1:1, 256x256px.
`.trim();

const STATE_DESCRIPTIONS = {
  idle: "sitting at a wooden desk, sipping coffee and looking relaxed",
  working: "typing enthusiastically on a keyboard with focused eyes",
  thinking: "resting chin on paw with a question mark floating above head",
  completed: "jumping with joy with arms raised in celebration",
  error: "looking startled with a sweat drop, holding up a small warning sign",
};

export class ImageGen {
  #apiKey = null;

  /**
   * @param {string} [apiKey] OpenAI API key. If not provided, reads from OPENAI_API_KEY env.
   */
  constructor(apiKey) {
    this.#apiKey = apiKey ?? process.env.OPENAI_API_KEY ?? null;
  }

  /**
   * Check if the API key is configured.
   * @returns {boolean}
   */
  get isConfigured() {
    return this.#apiKey !== null && this.#apiKey.length > 0;
  }

  /**
   * Generate a character image.
   * @param {object} options
   * @param {string} options.animal
   * @param {string} options.name
   * @param {string} options.role
   * @param {string} [options.state="idle"]
   * @returns {Promise<{url: string} | null>}
   */
  async generateCharacter({ animal, name, role, state = "idle" }) {
    if (!this.isConfigured) {
      process.stderr.write("[image-gen] No OpenAI API key configured. Skipping character generation.\n");
      return null;
    }

    const stateDesc = STATE_DESCRIPTIONS[state] ?? STATE_DESCRIPTIONS.idle;
    const prompt = CHARACTER_PROMPT_TEMPLATE
      .replace("{animal}", animal)
      .replace("{name}", name)
      .replace("{role}", role)
      .replace("{state_description}", stateDesc);

    return this.#callImageApi(prompt, "1024x1024");
  }

  /**
   * Generate a furniture image.
   * @param {string} furnitureType
   * @returns {Promise<{url: string} | null>}
   */
  async generateFurniture(furnitureType) {
    if (!this.isConfigured) {
      process.stderr.write("[image-gen] No OpenAI API key configured. Skipping furniture generation.\n");
      return null;
    }

    const prompt = FURNITURE_PROMPT_TEMPLATE.replace("{furniture_type}", furnitureType);
    return this.#callImageApi(prompt, "1024x1024");
  }

  /**
   * @param {string} prompt
   * @param {string} size
   * @returns {Promise<{url: string} | null>}
   */
  async #callImageApi(prompt, size) {
    try {
      const response = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-image-1",
          prompt,
          n: 1,
          size,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        process.stderr.write(`[image-gen] API error: ${response.status} ${text}\n`);
        return null;
      }

      const data = await response.json();
      return { url: data.data?.[0]?.url ?? null };
    } catch (err) {
      process.stderr.write(`[image-gen] Request failed: ${err.message}\n`);
      return null;
    }
  }
}
