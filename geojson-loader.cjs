// Turbopack loader: lets `import x from "file.geojson"` return the parsed object.
module.exports = function geojsonLoader(source) {
  return `export default ${source};`;
};
