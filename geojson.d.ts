// .geojson files import as parsed JSON (see geojson-loader.cjs).
declare module "*.geojson" {
  const value: GeoJSON.FeatureCollection;
  export default value;
}
