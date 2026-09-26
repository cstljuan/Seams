declare module '*.geojson' {
  const data: import('geojson').FeatureCollection;
  export default data;
}
