#!/usr/bin/env python3
"""
florida_gps.py

Basic GPS window for the Florida region.

The map is PyGPSClient's CanvasMap inside a tkinter window. With no
receiver attached it runs a simulated route through Florida cities.
A serial NMEA receiver replaces that route when you connect one.

Street and satellite tiles are optional. They call MapQuest, so set
MQAPIKEY or pass --mqapikey. The built-in Florida chart does not need a key.
"""

from __future__ import annotations

import argparse
import math
import os
import queue
import tempfile
import threading
import time
from pathlib import Path

import tkinter as tk
import tkinter.font as tkfont

try:
    from PIL import Image, ImageDraw, ImageFont
    from pygpsclient import canvas_map as canvas_map_mod
    from pygpsclient.canvas_map import CanvasMap
    from pygpsclient.globals import (
        BGCOL,
        ERRCOL,
        FGCOL,
        OKCOL,
        PNTCOL,
        Area,
        Point,
    )
    from pygpsclient.helpers import point_in_bounds
    from pynmeagps import NMEAParseError, NMEAReader
    from serial import Serial
    from serial.tools import list_ports
except ImportError as exc:
    raise SystemExit(
        "PyGPSClient is required for this window.\n"
        "Install it with:  pip install pygpsclient\n"
        f"Import failed: {exc}"
    ) from exc


# Bounding box that covers the Florida peninsula, the panhandle, and the Keys.
FLORIDA_REGION = Area(24.396308, -87.634938, 31.000968, -79.974307)

# Chart image extent, with ocean margin so a zoomed view can sit on the coast.
CHART_BOUNDS = Area(23.40, -89.20, 32.00, -78.20)
FLORIDA_CENTER = Point(27.8000, -83.7000)

PANEL = "#2a2a2a"
ONLINE_MAPS = {"map", "sat", "hyb"}
ONLINE_INTERVAL = 60.0
LEG_SECONDS = 18.0
BAUD_RATES = (4800, 9600, 19200, 38400, 57600, 115200)

# name, latitude, longitude. Order is the demo tour.
PLACES = (
    ("Miami", 25.7617, -80.1918),
    ("Fort Lauderdale", 26.1224, -80.1373),
    ("West Palm Beach", 26.7153, -80.0534),
    ("Cape Canaveral", 28.3922, -80.6077),
    ("Orlando", 28.5383, -81.3792),
    ("Jacksonville", 30.3322, -81.6557),
    ("Gainesville", 29.6516, -82.3248),
    ("Tallahassee", 30.4383, -84.2807),
    ("Pensacola", 30.4213, -87.2169),
    ("Tampa", 27.9506, -82.4572),
    ("St. Petersburg", 27.7676, -82.6403),
    ("Fort Myers", 26.6406, -81.8723),
    ("Naples", 26.1420, -81.7948),
    ("Key West", 24.5551, -81.7800),
)

# Simplified coastline, closed, clockwise from the northwest corner.
FLORIDA_OUTLINE = (
    (30.997, -87.530),
    (31.000, -85.000),
    (30.710, -84.880),
    (30.720, -81.880),
    (30.670, -81.470),
    (30.330, -81.390),
    (29.850, -81.270),
    (29.150, -80.980),
    (28.460, -80.560),
    (27.860, -80.450),
    (27.140, -80.160),
    (26.550, -80.040),
    (25.900, -80.070),
    (25.700, -80.150),
    (25.350, -80.280),
    (25.130, -80.450),
    (24.700, -81.250),
    (24.550, -81.800),
    (24.710, -81.480),
    (25.170, -80.950),
    (25.850, -81.650),
    (26.450, -81.950),
    (26.750, -82.220),
    (27.330, -82.580),
    (27.760, -82.780),
    (28.050, -82.830),
    (28.850, -82.700),
    (29.150, -83.050),
    (29.700, -83.550),
    (29.920, -83.850),
    (29.720, -84.750),
    (29.960, -85.420),
    (30.180, -85.800),
    (30.390, -86.500),
    (30.400, -87.220),
    (30.270, -87.530),
    (30.997, -87.530),
)


def _as_float(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _chart_font(size: int) -> ImageFont.ImageFont:
    for path in (r"C:\Windows\Fonts\segoeui.ttf", r"C:\Windows\Fonts\arial.ttf"):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def _to_pixel(lat: float, lon: float, width: int, height: int) -> tuple[float, float]:
    x = (lon - CHART_BOUNDS.lon1) / (CHART_BOUNDS.lon2 - CHART_BOUNDS.lon1) * width
    y = height - (lat - CHART_BOUNDS.lat1) / (CHART_BOUNDS.lat2 - CHART_BOUNDS.lat1) * height
    return x, y


def build_florida_chart() -> Path:
    """Write an equirectangular Florida chart PyGPSClient can georeference."""
    width, height = 1100, 860
    image = Image.new("RGB", (width, height), "#16324f")
    draw = ImageDraw.Draw(image)
    label_font = _chart_font(16)
    small_font = _chart_font(13)
    title_font = _chart_font(28)

    outline = [_to_pixel(lat, lon, width, height) for lat, lon in FLORIDA_OUTLINE]
    draw.polygon(outline, fill="#3d6b45", outline="#e4efd4")

    grid_font = _chart_font(12)
    for lat in range(24, 32):
        x0, y = _to_pixel(lat, CHART_BOUNDS.lon1, width, height)
        x1, _ = _to_pixel(lat, CHART_BOUNDS.lon2, width, height)
        draw.line((x0, y, x1, y), fill="#8fb4d4")
        draw.text((8, y - 14), f"{lat}N", fill="#d5e6f5", font=grid_font)
    for lon in range(-89, -78):
        x, y0 = _to_pixel(CHART_BOUNDS.lat2, lon, width, height)
        _, y1 = _to_pixel(CHART_BOUNDS.lat1, lon, width, height)
        draw.line((x, y0, x, y1), fill="#8fb4d4")
        draw.text((x + 4, 8), f"{abs(lon)}W", fill="#d5e6f5", font=grid_font)

    title_xy = _to_pixel(27.6, -83.4, width, height)
    draw.text(title_xy, "FLORIDA", fill="#d7e6c8", font=title_font)
    draw.text(_to_pixel(26.2, -86.3, width, height), "Gulf of Mexico", fill="#c5d7ea", font=label_font)
    draw.text(_to_pixel(29.2, -79.6, width, height), "Atlantic", fill="#c5d7ea", font=label_font)

    for name, lat, lon in PLACES:
        x, y = _to_pixel(lat, lon, width, height)
        draw.ellipse((x - 4, y - 4, x + 4, y + 4), fill="#ffb000", outline="#1b1b1b")
        if name == "Tampa":
            text_xy = (x + 8, y - 16)
        elif name == "St. Petersburg":
            text_xy = (x + 8, y + 4)
        elif lon > -80.4:
            text_xy = (x - draw.textlength(name, font=small_font) - 8, y - 8)
        else:
            text_xy = (x + 7, y - 8)
        draw.text(text_xy, name, fill="#f7f7f7", font=small_font)

    folder = Path(tempfile.gettempdir()) / "florida_gps"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / "florida_chart.png"
    image.save(path)
    return path


class FloridaGpsApp(tk.Tk):
    """Tk window that hosts PyGPSClient's map canvas for Florida."""

    def __init__(self, api_key: str = ""):
        super().__init__()
        self.title("Florida GPS")
        self.geometry("1100x720")
        self.minsize(880, 560)
        self.configure(bg=BGCOL)

        # CanvasMap reads these off the host application.
        self.font_sm = tkfont.Font(family="Segoe UI", size=10)
        self.font_ui = tkfont.Font(family="Segoe UI", size=11)
        self.font_value = tkfont.Font(family="Consolas", size=12)
        chart_path = build_florida_chart()
        self.configuration = {
            "mqapikey_s": api_key,
            "mapzoom_disabled_b": True,
            "usermaps_l": [
                [
                    str(chart_path),
                    [
                        CHART_BOUNDS.lat1,
                        CHART_BOUNDS.lon1,
                        CHART_BOUNDS.lat2,
                        CHART_BOUNDS.lon2,
                    ],
                ]
            ],
        }

        self.position: Point | None = None
        self.track: list[Point] = []
        self._fix = "NO FIX"
        self._alt = "—"
        self._speed = "—"
        self._course = "—"
        self._sats = "—"
        self._hdop = "—"
        self._demo_running = False
        self._leg_index = 0
        self._leg_from = FLORIDA_CENTER
        self._leg_to = FLORIDA_CENTER
        self._leg_started = time.monotonic()
        self._ready = False
        self._last_online = 0.0
        self._resize_after: str | None = None
        self._queue: queue.Queue = queue.Queue()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._serial: Serial | None = None

        self._build_widgets()
        self._refresh_ports()
        self.protocol("WM_DELETE_WINDOW", self._on_close)
        self.after(200, self._first_draw)

    def _build_widgets(self) -> None:
        body = tk.Frame(self, bg=BGCOL)
        body.pack(fill=tk.BOTH, expand=True)

        sidebar = tk.Frame(body, bg=BGCOL, width=300)
        sidebar.pack(side=tk.LEFT, fill=tk.Y)
        sidebar.pack_propagate(False)

        inner = tk.Frame(sidebar, bg=BGCOL)
        inner.pack(fill=tk.BOTH, expand=True, padx=12, pady=10)

        tk.Label(
            inner,
            text="Florida GPS",
            bg=BGCOL,
            fg=PNTCOL,
            font=tkfont.Font(family="Segoe UI", size=16, weight="bold"),
            anchor="w",
        ).pack(fill=tk.X)
        tk.Label(
            inner,
            text="PyGPSClient map, Florida region",
            bg=BGCOL,
            fg=FGCOL,
            font=self.font_sm,
            anchor="w",
        ).pack(fill=tk.X, pady=(0, 8))

        self._source = tk.StringVar(value="Demo")
        self._port = tk.StringVar()
        self._baud = tk.StringVar(value="9600")
        self._maptype = tk.StringVar(value="custom")
        self._zoom = tk.StringVar(value="state")

        self._option_row(inner, "Source", self._source, ("Demo", "Serial"))
        self._port_menu = self._option_row(inner, "Port", self._port, ("(no ports)",))
        baud_row = tk.Frame(inner, bg=BGCOL)
        baud_row.pack(fill=tk.X, pady=2)
        tk.Label(baud_row, text="Baud", width=8, anchor="w", bg=BGCOL, fg=FGCOL, font=self.font_ui).pack(side=tk.LEFT)
        tk.Spinbox(
            baud_row,
            values=BAUD_RATES,
            textvariable=self._baud,
            width=12,
            state="readonly",
            justify="left",
            bg=PANEL,
            fg=FGCOL,
            buttonbackground=BGCOL,
            readonlybackground=PANEL,
        ).pack(side=tk.LEFT, fill=tk.X, expand=True)
        tk.Button(
            baud_row,
            text="Ports",
            command=self._refresh_ports,
            bg=PANEL,
            fg=FGCOL,
            activebackground=PNTCOL,
            relief=tk.FLAT,
            padx=6,
        ).pack(side=tk.LEFT, padx=(6, 0))

        self._connect_btn = tk.Button(
            inner,
            text="Connect",
            command=self._on_connect,
            bg=PNTCOL,
            fg="#1b1b1b",
            activebackground="#ffc45a",
            relief=tk.FLAT,
            font=self.font_ui,
            pady=4,
        )
        self._connect_btn.pack(fill=tk.X, pady=(8, 8))

        self._vars = {name: tk.StringVar(value="—") for name in (
            "fix", "lat", "lon", "alt", "speed", "course", "sats", "hdop", "region",
        )}
        self._vars["region"].set("Waiting for a fix")
        labels = (
            ("fix", "Fix"),
            ("lat", "Lat"),
            ("lon", "Lon"),
            ("alt", "Alt"),
            ("speed", "Speed"),
            ("course", "Course"),
            ("sats", "Sats"),
            ("hdop", "HDOP"),
        )
        for key, caption in labels:
            row = tk.Frame(inner, bg=BGCOL)
            row.pack(fill=tk.X, pady=1)
            tk.Label(row, text=caption, width=8, anchor="w", bg=BGCOL, fg=FGCOL, font=self.font_ui).pack(side=tk.LEFT)
            tk.Label(
                row,
                textvariable=self._vars[key],
                anchor="w",
                bg=PANEL,
                fg=FGCOL,
                font=self.font_value,
                padx=6,
            ).pack(side=tk.LEFT, fill=tk.X, expand=True)

        self._region = tk.Label(
            inner,
            textvariable=self._vars["region"],
            bg=BGCOL,
            fg=PNTCOL,
            font=self.font_ui,
            anchor="w",
        )
        self._region.pack(fill=tk.X, pady=(6, 4))

        self._status = tk.Label(
            inner,
            text="Florida chart is ready.",
            bg=BGCOL,
            fg=FGCOL,
            font=self.font_sm,
            anchor="w",
            justify=tk.LEFT,
            wraplength=270,
        )
        self._status.pack(fill=tk.X, pady=(0, 6))

        tk.Label(inner, text="Places", bg=BGCOL, fg=PNTCOL, font=self.font_ui, anchor="w").pack(fill=tk.X)
        self._places = tk.Listbox(
            inner,
            height=8,
            bg=PANEL,
            fg=FGCOL,
            selectbackground=PNTCOL,
            selectforeground="#1b1b1b",
            highlightthickness=0,
            activestyle="none",
            font=self.font_ui,
            exportselection=False,
        )
        for name, _lat, _lon in PLACES:
            self._places.insert(tk.END, name)
        self._places.pack(fill=tk.BOTH, expand=True, pady=(2, 6))
        self._places.bind("<<ListboxSelect>>", self._on_place)

        self._option_row(inner, "Map", self._maptype, ("custom", "world", "map", "sat", "hyb"))
        self._option_row(inner, "Zoom", self._zoom, ("state", "6", "7", "8", "9", "10", "11", "12"))
        self._maptype.trace_add("write", lambda *_: self._redraw_map(force=True))
        self._zoom.trace_add("write", lambda *_: self._redraw_map(force=True))

        map_frame = tk.Frame(body, bg=BGCOL)
        map_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(0, 8), pady=8)
        self.canvas = CanvasMap(self, map_frame, width=740, height=680, highlightthickness=0)
        self.canvas.pack(fill=tk.BOTH, expand=True)
        self.canvas.bind("<Configure>", self._on_configure, add="+")

    def _option_row(self, parent: tk.Frame, caption: str, variable: tk.StringVar, values: tuple[str, ...]) -> tk.OptionMenu:
        row = tk.Frame(parent, bg=BGCOL)
        row.pack(fill=tk.X, pady=2)
        tk.Label(row, text=caption, width=8, anchor="w", bg=BGCOL, fg=FGCOL, font=self.font_ui).pack(side=tk.LEFT)
        menu = tk.OptionMenu(row, variable, *values)
        menu.configure(
            bg=PANEL,
            fg=FGCOL,
            activebackground=PNTCOL,
            activeforeground="#1b1b1b",
            highlightthickness=0,
            relief=tk.FLAT,
            font=self.font_ui,
        )
        menu["menu"].configure(bg=PANEL, fg=FGCOL, font=self.font_ui)
        menu.pack(side=tk.LEFT, fill=tk.X, expand=True)
        return menu

    def _set_status(self, text: str, color: str = FGCOL) -> None:
        self._status.configure(text=text, fg=color)

    def _refresh_ports(self) -> None:
        ports = [item.device for item in list_ports.comports()]
        menu = self._port_menu["menu"]
        menu.delete(0, tk.END)
        choices = ports or ["(no ports)"]
        for port in choices:
            menu.add_command(label=port, command=lambda value=port: self._port.set(value))
        if self._port.get() not in choices:
            self._port.set(choices[0])

    def _refresh_labels(self) -> None:
        self._vars["fix"].set(self._fix)
        self._vars["alt"].set(self._alt)
        self._vars["speed"].set(self._speed)
        self._vars["course"].set(self._course)
        self._vars["sats"].set(self._sats)
        self._vars["hdop"].set(self._hdop)
        if self.position is None:
            self._vars["lat"].set("—")
            self._vars["lon"].set("—")
            self._vars["region"].set("Waiting for a fix")
            self._region.configure(fg=PNTCOL)
            return
        self._vars["lat"].set(f"{self.position.lat:.6f}")
        self._vars["lon"].set(f"{self.position.lon:.6f}")
        inside = point_in_bounds(FLORIDA_REGION, self.position)
        self._vars["region"].set("Inside Florida" if inside else "Outside Florida")
        self._region.configure(fg=OKCOL if inside else ERRCOL)

    def _append_track(self, point: Point) -> None:
        if self.track:
            last = self.track[-1]
            if abs(last.lat - point.lat) < 1e-5 and abs(last.lon - point.lon) < 1e-5:
                return
        self.track.append(point)
        if len(self.track) > 400:
            del self.track[0]

    def _arm_leg(self) -> None:
        if self.position is None:
            return
        nxt = PLACES[(self._leg_index + 1) % len(PLACES)]
        self._leg_from = self.position
        self._leg_to = Point(nxt[1], nxt[2])
        self._leg_started = time.monotonic()
        east = (self._leg_to.lon - self._leg_from.lon) * math.cos(math.radians(self._leg_from.lat))
        north = self._leg_to.lat - self._leg_from.lat
        bearing = (math.degrees(math.atan2(east, north)) + 360) % 360
        self._course = f"{bearing:.0f}°"

    def _advance_demo(self) -> None:
        if self.position is None:
            return
        elapsed = time.monotonic() - self._leg_started
        t = min(elapsed / LEG_SECONDS, 1.0)
        lat = self._leg_from.lat + (self._leg_to.lat - self._leg_from.lat) * t
        lon = self._leg_from.lon + (self._leg_to.lon - self._leg_from.lon) * t
        self.position = Point(lat, lon)
        self._append_track(self.position)
        if t >= 1.0:
            self._leg_index = (self._leg_index + 1) % len(PLACES)
            arrived = PLACES[self._leg_index][0]
            self._set_status(f"Demo reached {arrived}.", OKCOL)
            self._arm_leg()

    def _zoom_window(self, zoom: int) -> tuple[float, float]:
        half_lon = 90 / 2**zoom
        half_lat = half_lon * max(self.canvas.height, 1) / max(self.canvas.width, 1)
        return half_lat, half_lon

    def _zoom_fits(self, zoom: int) -> bool:
        half_lat, half_lon = self._zoom_window(zoom)
        return (
            half_lat * 2 < (CHART_BOUNDS.lat2 - CHART_BOUNDS.lat1)
            and half_lon * 2 < (CHART_BOUNDS.lon2 - CHART_BOUNDS.lon1)
        )

    def _clamp_center(self, point: Point, zoom: int) -> Point:
        half_lat, half_lon = self._zoom_window(zoom)
        lat = min(max(point.lat, CHART_BOUNDS.lat1 + half_lat), CHART_BOUNDS.lat2 - half_lat)
        lon = min(max(point.lon, CHART_BOUNDS.lon1 + half_lon), CHART_BOUNDS.lon2 - half_lon)
        return Point(lat, lon)

    def _sync_canvas_size(self) -> None:
        self.update_idletasks()
        width = self.canvas.winfo_width()
        height = self.canvas.winfo_height()
        if width > 20 and height > 20:
            self.canvas.width = width
            self.canvas.height = height

    def _paint_marker(self) -> None:
        self.canvas.delete(canvas_map_mod.TAG_LOCATION)
        bounds = self.canvas.bounds
        if self.position is None or bounds is None:
            return
        if not point_in_bounds(bounds, self.position):
            return
        self.canvas.draw_marker(self.position)
        if len(self.track) > 1:
            self.canvas.draw_track(self.track)

    def _redraw_map(self, force: bool = False) -> None:
        if not self._ready:
            return
        self._sync_canvas_size()
        maptype = self._maptype.get()
        full_state = self._zoom.get() == "state"
        zoom = 4 if full_state else int(self._zoom.get())
        online = maptype in ONLINE_MAPS

        if online and not force and (time.monotonic() - self._last_online) < ONLINE_INTERVAL:
            self._paint_marker()
            return
        if online and not self.configuration.get("mqapikey_s"):
            self._set_status(
                "Street and satellite maps need a MapQuest key in MQAPIKEY or --mqapikey.",
                ERRCOL,
            )

        if maptype == "custom":
            use_full = full_state or not self._zoom_fits(zoom)
            self.configuration["mapzoom_disabled_b"] = use_full
            if self.position is not None and point_in_bounds(CHART_BOUNDS, self.position):
                center = self.position
            else:
                center = FLORIDA_CENTER
            if not use_full:
                center = self._clamp_center(center, zoom)
        else:
            self.configuration["mapzoom_disabled_b"] = maptype == "world"
            center = self.position or FLORIDA_CENTER

        try:
            self.canvas.draw_map(maptype=maptype, location=center, zoom=zoom)
        except Exception as exc:
            self._set_status(str(exc), ERRCOL)
            return
        if online:
            self._last_online = time.monotonic()
        self._paint_marker()

    def _on_configure(self, event) -> None:
        if event.widget is not self.canvas or not self._ready:
            return
        if self._resize_after is not None:
            self.after_cancel(self._resize_after)
        self._resize_after = self.after(250, lambda: self._redraw_map(force=True))

    def _first_draw(self) -> None:
        self._ready = True
        self._redraw_map(force=True)
        self._refresh_labels()
        self.after(200, self._tick)

    def _tick(self) -> None:
        self._drain_serial()
        moved = False
        if self._demo_running:
            self._advance_demo()
            moved = True
        self._refresh_labels()
        if moved and self.position is not None:
            bounds = self.canvas.bounds
            if bounds is not None and not point_in_bounds(bounds, self.position):
                self._redraw_map(force=False)
            else:
                self._paint_marker()
        if self.winfo_exists():
            self.after(200, self._tick)

    def _on_place(self, _event=None) -> None:
        if self._thread is not None:
            self._set_status("Disconnect the receiver before jumping to a city.", ERRCOL)
            return
        selection = self._places.curselection()
        if not selection:
            return
        name, lat, lon = PLACES[selection[0]]
        self.position = Point(lat, lon)
        self.track = [self.position]
        self._leg_index = selection[0]
        self._fix = "SIM"
        self._speed = "simulated"
        self._alt = "—"
        self._sats = "—"
        self._hdop = "—"
        self._arm_leg()
        self._demo_running = True
        self._source.set("Demo")
        self._connect_btn.configure(text="Disconnect")
        self._refresh_labels()
        self._redraw_map(force=True)
        self._set_status(f"Marker set to {name}.", OKCOL)

    def _on_connect(self) -> None:
        if self._demo_running or self._thread is not None:
            self._stop_sources()
            self._connect_btn.configure(text="Connect")
            self._fix = "NO FIX"
            self._speed = "—"
            self._course = "—"
            self._refresh_labels()
            self._set_status("Disconnected.", PNTCOL)
            return
        if self._source.get() == "Serial":
            self._start_serial()
        else:
            self._start_demo()

    def _start_demo(self, automatic: bool = False) -> None:
        if automatic and (
            self._source.get() != "Demo" or self._demo_running or self._thread is not None
        ):
            return
        self._stop_sources()
        name, lat, lon = PLACES[0]
        self.position = Point(lat, lon)
        self.track = [self.position]
        self._leg_index = 0
        self._fix = "SIM"
        self._speed = "simulated"
        self._alt = "—"
        self._sats = "—"
        self._hdop = "—"
        self._arm_leg()
        self._demo_running = True
        self._source.set("Demo")
        self._connect_btn.configure(text="Disconnect")
        self._refresh_labels()
        self._redraw_map(force=True)
        self._set_status(f"Demo track started at {name}.", OKCOL)

    def _start_serial(self) -> None:
        self._stop_sources()
        port = self._port.get().strip()
        if not port or port.startswith("("):
            self._set_status("No serial port selected.", ERRCOL)
            return
        try:
            baud = int(self._baud.get())
        except ValueError:
            self._set_status("Baud rate is not a number.", ERRCOL)
            return
        self.position = None
        self.track = []
        self._fix = "NO FIX"
        self._alt = "—"
        self._speed = "—"
        self._course = "—"
        self._sats = "—"
        self._hdop = "—"
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._read_serial,
            args=(port, baud),
            daemon=True,
        )
        self._thread.start()
        self._connect_btn.configure(text="Disconnect")
        self._refresh_labels()
        self._redraw_map(force=True)
        self._set_status(f"Listening on {port} at {baud} baud.", OKCOL)

    def _read_serial(self, port: str, baud: int) -> None:
        try:
            serial_port = Serial(port, baud, timeout=1)
            self._serial = serial_port
            reader = NMEAReader(serial_port)
            while not self._stop.is_set():
                try:
                    _raw, parsed = reader.read()
                except NMEAParseError:
                    continue
                if parsed is not None:
                    self._queue.put(("nmea", parsed))
        except Exception as exc:
            self._queue.put(("error", str(exc)))
        finally:
            serial_port_ref = self._serial
            if serial_port_ref is not None:
                try:
                    serial_port_ref.close()
                except Exception:
                    pass
            self._queue.put(("closed", None))

    def _drain_serial(self) -> None:
        while True:
            try:
                kind, payload = self._queue.get_nowait()
            except queue.Empty:
                return
            if kind == "error":
                self._set_status(str(payload), ERRCOL)
                self._fix = "NO FIX"
            elif kind == "closed":
                self._thread = None
                self._serial = None
                if not self._demo_running:
                    self._connect_btn.configure(text="Connect")
            elif kind == "nmea":
                self._apply_nmea(payload)

    def _apply_nmea(self, parsed) -> None:
        msg_id = getattr(parsed, "msgID", "")
        if msg_id == "GGA":
            quality = int(getattr(parsed, "quality", 0) or 0)
            lat = _as_float(getattr(parsed, "lat", None))
            lon = _as_float(getattr(parsed, "lon", None))
            self._fix = "NO FIX" if quality == 0 else "3D" if quality == 1 else f"FIX {quality}"
            alt = _as_float(getattr(parsed, "alt", None))
            sats = getattr(parsed, "numSV", None)
            hdop = _as_float(getattr(parsed, "HDOP", None))
            if alt is not None:
                self._alt = f"{alt:.1f} m"
            self._sats = "—" if sats in (None, "") else str(sats)
            self._hdop = "—" if hdop is None else f"{hdop:.1f}"
            if quality > 0 and lat is not None and lon is not None:
                self.position = Point(lat, lon)
                self._append_track(self.position)
                if point_in_bounds(FLORIDA_REGION, self.position):
                    self._set_status("Live fix inside Florida.", OKCOL)
                else:
                    self._set_status("Live fix is outside the Florida region.", ERRCOL)
        elif msg_id == "RMC" and getattr(parsed, "status", "V") == "A":
            lat = _as_float(getattr(parsed, "lat", None))
            lon = _as_float(getattr(parsed, "lon", None))
            spd = _as_float(getattr(parsed, "spd", None))
            cog = _as_float(getattr(parsed, "cog", None))
            if lat is not None and lon is not None:
                self.position = Point(lat, lon)
                self._append_track(self.position)
            if spd is not None:
                self._speed = f"{spd:.1f} kn"
            if cog is not None:
                self._course = f"{cog:.0f}°"
            if self._fix == "NO FIX":
                self._fix = "3D"

    def _stop_sources(self) -> None:
        self._demo_running = False
        self._stop.set()
        serial_port = self._serial
        if serial_port is not None:
            try:
                serial_port.close()
            except Exception:
                pass
        thread = self._thread
        if thread is not None and thread.is_alive():
            thread.join(timeout=2)
        self._thread = None
        self._serial = None
        self._stop = threading.Event()

    def use_port(self, port: str, baud: int) -> None:
        self._source.set("Serial")
        self._refresh_ports()
        self._port.set(port)
        self._baud.set(str(baud))

    def _on_close(self) -> None:
        self._stop_sources()
        self.destroy()


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Basic Florida GPS window using PyGPSClient.")
    parser.add_argument("--port", help="Serial port for a live NMEA receiver, for example COM3.")
    parser.add_argument("--baud", type=int, default=9600, help="Serial baud rate. Default: 9600.")
    parser.add_argument(
        "--mqapikey",
        default=os.environ.get("MQAPIKEY", ""),
        help="MapQuest key for street and satellite tiles. Defaults to the MQAPIKEY environment variable.",
    )
    args = parser.parse_args(argv)

    app = FloridaGpsApp(api_key=args.mqapikey)
    if args.port:
        app.use_port(args.port, args.baud)
        app.after(400, app._start_serial)
    else:
        app.after(400, lambda: app._start_demo(automatic=True))
    app.mainloop()


if __name__ == "__main__":
    main()
