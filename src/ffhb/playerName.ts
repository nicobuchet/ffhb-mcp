export interface PlayerName {
  firstName: string;
  lastName: string;
}

// FFHB sheets print the family name in capitals, followed by the given name.
// Read that boundary before normalizing case, preserving multiword surnames.
export function splitPlayerName(value: string): PlayerName {
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  const boundary = tokens.findIndex((token) => /\p{L}/u.test(token) && token !== token.toUpperCase());
  if (boundary > 0) {
    return {
      firstName: formatName(tokens.slice(boundary).join(" ")),
      lastName: formatName(tokens.slice(0, boundary).join(" ")),
    };
  }
  // A display name alone cannot reliably distinguish given and family names.
  return { firstName: formatName(tokens.join(" ")), lastName: "" };
}

function formatName(value: string): string {
  return value.toLowerCase().replace(/\p{L}+/gu, (part) => part.charAt(0).toUpperCase() + part.slice(1));
}
