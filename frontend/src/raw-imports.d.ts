// Build-time config files are read as text in specs.
declare module '*?raw' {
  const content: string;
  export default content;
}
