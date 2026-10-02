export interface PromptSectionOptions {
  isToolActive: boolean;
  configEnabled?: boolean;
  promptEnabled?: boolean;
  hooksEnabled?: boolean;
}

export const GATHER_PROMPT_SECTION_KEY = "gather_smart_objects";

export function buildGatherPromptText(hooksEnabled: boolean): string {
  const hooksNotice = hooksEnabled
    ? "Los hooks gestionan el estado y color de presencia; no los dupliques por rutina."
    : "Los hooks de presencia automática están inactivos.";

  return (
    `Usa gather_send cuando te pidan controlar Gather o publicar un hito autorizado. ` +
    `${hooksNotice} webhook.ping consulta el objeto; info.set cambia nombre/descripción ` +
    `y activity.add publica con id estable. El feed es visible para toda la oficina: ` +
    `nunca secretos ni contenido privado.`
  );
}

export function shouldInjectPrompt(options: PromptSectionOptions): boolean {
  if (!options.isToolActive) return false;
  if (options.configEnabled === false) return false;
  if (options.promptEnabled === false) return false;
  return true;
}

export function getPromptSectionContent(options: PromptSectionOptions): string | undefined {
  if (!shouldInjectPrompt(options)) {
    return undefined;
  }
  return buildGatherPromptText(options.hooksEnabled ?? false);
}
