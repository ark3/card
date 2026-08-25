// Bun's `with { type: "text" }` imports resolve markdown files to their text.
declare module "*.md" {
  const text: string;
  export default text;
}
