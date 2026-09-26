'use client';

import { useState } from 'react';
import Map, { Marker, NavigationControl } from 'react-map-gl/maplibre';
import type { FeatureCollection, Point } from 'geojson';
import projects from '@/data/fixtures/projects.geojson';
import Mascot from './Mascot';
import './map-shell.css';

type ProjectProperties = { id: string; utility: 'DESC' | 'GPC'; name: string };
const projectData = projects as FeatureCollection<Point, ProjectProperties>;

export default function MapShell() {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <main className="shell">
      <section className="map-panel" aria-label="Project map">
        <Map
          initialViewState={{ longitude: -82.2, latitude: 33.45, zoom: 7.2 }}
          mapStyle="https://tiles.openfreemap.org/styles/positron"
          reuseMaps
        >
          <NavigationControl position="top-right" />
          {projectData.features.map((feature) => {
            const [longitude, latitude] = feature.geometry.coordinates;
            const utility = feature.properties.utility;
            return (
              <Marker key={feature.properties.id} longitude={longitude} latitude={latitude} anchor="center">
                <div className={`project-marker ${utility === 'DESC' ? 'utility-a' : 'utility-b'}`} title={`${utility}: ${feature.properties.name}`} aria-label={`${utility}: ${feature.properties.name}`} />
              </Marker>
            );
          })}
        </Map>
        <div className="map-brand"><Mascot /></div>
      </section>
      <button
        className={`sidebar-toggle ${sidebarOpen ? 'is-open' : ''}`}
        type="button"
        onClick={() => setSidebarOpen((open) => !open)}
        aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        aria-expanded={sidebarOpen}
      >{sidebarOpen ? '›' : '‹'}</button>
      <aside className={`sidebar ${sidebarOpen ? '' : 'is-collapsed'}`} aria-label="Project tools">
        <div className="sidebar-heading"><span className="eyebrow">SEAMS</span><h1>Project map</h1></div>
        <label className="search-placeholder">
          <span className="visually-hidden">Search location</span>
          <input disabled placeholder="Search location" />
        </label>
        <div className="filter-placeholder" aria-label="Filters">
          <span className="placeholder-chip">Start date</span><span className="placeholder-chip">End date</span><span className="placeholder-chip">Time overlaps</span>
        </div>
        <div className="list-placeholder">
          <div className="list-placeholder-heading"><h2>Nearby projects</h2><span>{projectData.features.length}</span></div>
          <p>Overlap results will appear here.</p>
        </div>
        <div className="sidebar-footer">Sample data · Sperry Tech GridLock</div>
      </aside>
    </main>
  );
}
