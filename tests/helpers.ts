export function smartfireComponentHtml(componentName: string, attributes: unknown): string {
  return `<smartfire-component name='${componentName}' attributes='${escapeAttribute(
    JSON.stringify(attributes),
  )}'></smartfire-component>`;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
