#!/usr/bin/env python3
"""Generates the four provisioned Grafana dashboards (v3.20).

Dashboard JSON is long and repetitive; the panels are declared here in a few
lines each and the JSON is written to ./dashboards/. Both are committed: the
JSON is what Grafana loads, this file is what a reviewer reads.

    python3 deploy/monitoring/grafana/build-dashboards.py

Conventions: one Prometheus datasource (uid "prometheus"); the API and
Postgres dashboards carry an `env` variable (production / staging) read from
the scrape labels; every panel states its unit so Grafana formats the axis.
"""

from __future__ import annotations

import json
from pathlib import Path

OUT = Path(__file__).parent / "dashboards"
DS = {"type": "prometheus", "uid": "prometheus"}

# ---------------------------------------------------------------------------
# tiny panel builders


def _targets(queries):
    out = []
    for i, q in enumerate(queries):
        expr, legend = (q, "") if isinstance(q, str) else q
        out.append({"datasource": DS, "expr": expr, "legendFormat": legend, "refId": chr(65 + i)})
    return out


def timeseries(title, queries, unit="short", *, w=12, h=8, stack=False, minimum=None, maximum=None, desc=""):
    custom = {"lineWidth": 1, "fillOpacity": 12 if not stack else 40, "showPoints": "never"}
    if stack:
        custom["stacking"] = {"mode": "normal", "group": "A"}
    defaults = {"unit": unit, "custom": custom}
    if minimum is not None:
        defaults["min"] = minimum
    if maximum is not None:
        defaults["max"] = maximum
    return {
        "type": "timeseries",
        "title": title,
        "description": desc,
        "datasource": DS,
        "gridPos": {"w": w, "h": h},
        "fieldConfig": {"defaults": defaults, "overrides": []},
        "options": {
            "legend": {"displayMode": "list", "placement": "bottom", "showLegend": True},
            "tooltip": {"mode": "multi", "sort": "desc"},
        },
        "targets": _targets(queries),
    }


def stat(title, query, unit="short", *, w=4, h=4, thresholds=None, decimals=None, desc="", color_mode="value"):
    steps = [{"color": "green", "value": None}]
    for value, color in thresholds or []:
        steps.append({"color": color, "value": value})
    defaults = {"unit": unit, "thresholds": {"mode": "absolute", "steps": steps}}
    if decimals is not None:
        defaults["decimals"] = decimals
    return {
        "type": "stat",
        "title": title,
        "description": desc,
        "datasource": DS,
        "gridPos": {"w": w, "h": h},
        "fieldConfig": {"defaults": defaults, "overrides": []},
        "options": {
            "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
            "colorMode": color_mode,
            "graphMode": "none",
            "textMode": "value",
        },
        "targets": _targets([query]),
    }


def bargauge(title, query, unit="short", *, w=12, h=8, desc=""):
    return {
        "type": "bargauge",
        "title": title,
        "description": desc,
        "datasource": DS,
        "gridPos": {"w": w, "h": h},
        "fieldConfig": {
            "defaults": {"unit": unit, "min": 0, "color": {"mode": "palette-classic"}},
            "overrides": [],
        },
        "options": {
            "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
            "orientation": "horizontal",
            "displayMode": "gradient",
            "showUnfilled": True,
        },
        "targets": _targets([query]),
    }


def table(title, query, *, w=24, h=10, unit="short", desc=""):
    return {
        "type": "table",
        "title": title,
        "description": desc,
        "datasource": DS,
        "gridPos": {"w": w, "h": h},
        "fieldConfig": {"defaults": {"unit": unit}, "overrides": []},
        "options": {"showHeader": True, "sortBy": [{"displayName": "Value", "desc": True}]},
        "targets": [{**_targets([query])[0], "format": "table", "instant": True}],
        "transformations": [{"id": "organize", "options": {"excludeByName": {"Time": True}}}],
    }


def row(title):
    return {"type": "row", "title": title, "collapsed": False, "gridPos": {"w": 24, "h": 1}, "panels": []}


def layout(panels):
    """Assigns x/y: panels flow left to right, wrapping at 24 columns; a row starts a new line."""
    x = y = 0
    line_h = 0
    for i, p in enumerate(panels):
        g = p["gridPos"]
        if p["type"] == "row" or x + g["w"] > 24:
            x = 0
            y += line_h
            line_h = 0
        g["x"], g["y"] = x, y
        p["id"] = i + 1
        x += g["w"]
        line_h = max(line_h, g["h"])
    return panels


def dashboard(uid, title, panels, *, variables=(), tags=(), refresh="1m", description=""):
    return {
        "uid": uid,
        "title": title,
        "description": description,
        "tags": ["pioassets", *tags],
        "timezone": "browser",
        "editable": False,
        "graphTooltip": 1,
        "refresh": refresh,
        "schemaVersion": 39,
        "time": {"from": "now-6h", "to": "now"},
        "templating": {"list": list(variables)},
        "panels": layout(panels),
    }


def env_variable():
    return {
        "name": "env",
        "label": "Environment",
        "type": "query",
        "datasource": DS,
        "query": {"query": 'label_values(up{job="pioassets-api"}, env)', "refId": "env"},
        "definition": 'label_values(up{job="pioassets-api"}, env)',
        "refresh": 2,
        "sort": 1,
        "current": {"text": "production", "value": "production"},
        "options": [],
        "includeAll": False,
        "multi": False,
    }


# ---------------------------------------------------------------------------
# dashboards

HOST = dashboard(
    "pa-host",
    "Host",
    [
        stat("CPU busy", '100 * (1 - avg(rate(node_cpu_seconds_total{job="node",mode="idle"}[5m])))', "percent",
             thresholds=[(70, "orange"), (90, "red")], decimals=0),
        stat("Memory used", '100 * (1 - node_memory_MemAvailable_bytes{job="node"} / node_memory_MemTotal_bytes{job="node"})',
             "percent", thresholds=[(80, "orange"), (90, "red")], decimals=0),
        stat("Root disk used", '100 * (1 - node_filesystem_avail_bytes{job="node",mountpoint="/"} / node_filesystem_size_bytes{job="node",mountpoint="/"})',
             "percent", thresholds=[(75, "orange"), (85, "red")], decimals=0),
        stat("Root disk free", 'node_filesystem_avail_bytes{job="node",mountpoint="/"}', "bytes",
             thresholds=[(0, "red"), (10 * 2**30, "orange"), (20 * 2**30, "green")], decimals=1),
        stat("Load (1m) per CPU", 'node_load1{job="node"} / count(node_cpu_seconds_total{job="node",mode="idle"})', "short",
             thresholds=[(1, "orange"), (2, "red")], decimals=2),
        stat("Uptime", 'time() - node_boot_time_seconds{job="node"}', "s", decimals=0, color_mode="none"),
        timeseries("CPU by mode", [
            ('sum by (mode) (rate(node_cpu_seconds_total{job="node",mode!="idle"}[5m])) / count(node_cpu_seconds_total{job="node",mode="idle"})', "{{mode}}"),
        ], "percentunit", stack=True, minimum=0, maximum=1),
        timeseries("Memory", [
            ('node_memory_MemTotal_bytes{job="node"} - node_memory_MemAvailable_bytes{job="node"}', "used"),
            ('node_memory_Cached_bytes{job="node"} + node_memory_Buffers_bytes{job="node"}', "cache + buffers"),
            ('node_memory_MemTotal_bytes{job="node"}', "total"),
        ], "bytes", minimum=0),
        timeseries("Disk space used", [
            ('node_filesystem_size_bytes{job="node",fstype!~"tmpfs|overlay"} - node_filesystem_avail_bytes{job="node",fstype!~"tmpfs|overlay"}', "{{mountpoint}}"),
        ], "bytes", minimum=0),
        timeseries("Disk I/O", [
            ('sum(rate(node_disk_read_bytes_total{job="node"}[5m]))', "read"),
            ('sum(rate(node_disk_written_bytes_total{job="node"}[5m]))', "write"),
        ], "Bps", minimum=0),
        timeseries("Load average", [
            ('node_load1{job="node"}', "1m"), ('node_load5{job="node"}', "5m"), ('node_load15{job="node"}', "15m"),
        ], "short", minimum=0),
        timeseries("Swap used", [
            ('node_memory_SwapTotal_bytes{job="node"} - node_memory_SwapFree_bytes{job="node"}', "swap used"),
        ], "bytes", minimum=0),
    ],
    tags=["host"],
    description="The VPS itself. Shared by PioAssets (production + staging) and the desk portal.",
)

CONTAINERS = dashboard(
    "pa-containers",
    "Containers",
    [
        timeseries("CPU per container", [
            ('sum by (name) (rate(container_cpu_usage_seconds_total{job="cadvisor",name!=""}[5m]))', "{{name}}"),
        ], "percentunit", w=24, h=9, minimum=0),
        timeseries("Memory per container (working set)", [
            ('container_memory_working_set_bytes{job="cadvisor",name!=""}', "{{name}}"),
        ], "bytes", w=24, h=9, minimum=0),
        timeseries("Network received", [
            ('sum by (name) (rate(container_network_receive_bytes_total{job="cadvisor",name!=""}[5m]))', "{{name}}"),
        ], "Bps", minimum=0),
        timeseries("Network sent", [
            ('sum by (name) (rate(container_network_transmit_bytes_total{job="cadvisor",name!=""}[5m]))', "{{name}}"),
        ], "Bps", minimum=0),
        table("Starts in the last 24 h (above 1 means it restarted)",
              'changes(container_start_time_seconds{job="cadvisor",name!=""}[24h]) + 1',
              desc="A container that keeps restarting is crashing. The alert fires at more than two starts in an hour."),
        table("Memory now, by container", 'sort_desc(container_memory_working_set_bytes{job="cadvisor",name!=""})', unit="bytes"),
    ],
    tags=["containers"],
    description="Every container on the host, both products. Names are the compose container names.",
)

API = dashboard(
    "pa-api",
    "PioAssets API",
    [
        stat("Scrape", 'up{job="pioassets-api",env="$env"}', "short",
             thresholds=[(0, "red"), (1, "green")], desc="1 = Prometheus reached the API's metrics port on its last scrape."),
        stat("Requests / s", 'sum(rate(http_requests_total{job="pioassets-api",env="$env"}[5m]))', "reqps", decimals=2),
        stat("5xx rate", 'sum(rate(http_requests_total{job="pioassets-api",env="$env",status=~"5.."}[5m])) / sum(rate(http_requests_total{job="pioassets-api",env="$env"}[5m]))',
             "percentunit", thresholds=[(0.01, "orange"), (0.02, "red")], decimals=2),
        stat("p95 latency", 'histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{job="pioassets-api",env="$env",route!="unmatched"}[5m])))',
             "s", thresholds=[(1, "orange"), (2, "red")], decimals=2),
        stat("Memory (RSS)", 'process_resident_memory_bytes{job="pioassets-api",env="$env"}', "bytes",
             thresholds=[(600 * 2**20, "orange"), (900 * 2**20, "red")], decimals=0),
        stat("Event-loop lag p99", 'nodejs_eventloop_lag_p99_seconds{job="pioassets-api",env="$env"}', "s",
             thresholds=[(0.1, "orange"), (0.5, "red")], decimals=3),
        row("Traffic"),
        timeseries("Requests by status class", [
            ('sum by (class) (label_replace(rate(http_requests_total{job="pioassets-api",env="$env"}[5m]), "class", "${1}xx", "status", "(.).."))', "{{class}}"),
        ], "reqps", stack=True, minimum=0),
        timeseries("Latency percentiles", [
            ('histogram_quantile(0.50, sum by (le) (rate(http_request_duration_seconds_bucket{job="pioassets-api",env="$env",route!="unmatched"}[5m])))', "p50"),
            ('histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{job="pioassets-api",env="$env",route!="unmatched"}[5m])))', "p95"),
            ('histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket{job="pioassets-api",env="$env",route!="unmatched"}[5m])))', "p99"),
        ], "s", minimum=0),
        timeseries("Busiest routes", [
            ('topk(8, sum by (method, route) (rate(http_requests_total{job="pioassets-api",env="$env"}[5m])))', "{{method}} {{route}}"),
        ], "reqps", minimum=0),
        timeseries("Slowest routes (p95)", [
            ('topk(8, histogram_quantile(0.95, sum by (le, method, route) (rate(http_request_duration_seconds_bucket{job="pioassets-api",env="$env",route!="unmatched"}[5m]))))', "{{method}} {{route}}"),
        ], "s", minimum=0),
        timeseries("Refused: rate limited (429) and unauthenticated (401)", [
            ('sum(rate(http_requests_total{job="pioassets-api",env="$env",status="429"}[5m]))', "429 rate limited"),
            ('sum(rate(http_requests_total{job="pioassets-api",env="$env",status="401"}[5m]))', "401 unauthenticated"),
            ('sum(rate(http_requests_total{job="pioassets-api",env="$env",route="unmatched"}[5m]))', "unknown paths (scanners)"),
        ], "reqps", minimum=0),
        timeseries("Server errors (5xx) by route", [
            ('sum by (method, route) (rate(http_requests_total{job="pioassets-api",env="$env",status=~"5.."}[5m]))', "{{method}} {{route}}"),
        ], "reqps", minimum=0),
        row("Process"),
        timeseries("Memory", [
            ('process_resident_memory_bytes{job="pioassets-api",env="$env"}', "RSS"),
            ('nodejs_heap_size_used_bytes{job="pioassets-api",env="$env"}', "heap used"),
            ('nodejs_heap_size_total_bytes{job="pioassets-api",env="$env"}', "heap total"),
        ], "bytes", w=8, minimum=0),
        timeseries("CPU", [
            ('rate(process_cpu_seconds_total{job="pioassets-api",env="$env"}[5m])', "cpu"),
        ], "percentunit", w=8, minimum=0),
        timeseries("Event-loop lag", [
            ('nodejs_eventloop_lag_p50_seconds{job="pioassets-api",env="$env"}', "p50"),
            ('nodejs_eventloop_lag_p99_seconds{job="pioassets-api",env="$env"}', "p99"),
        ], "s", w=8, minimum=0),
        row("Fleet (the business numbers the API counts once a minute)"),
        stat("Companies", 'techpioasset_companies_active{job="pioassets-api",env="$env"}', decimals=0, color_mode="none"),
        stat("Agents online", 'techpioasset_agents{job="pioassets-api",env="$env",status="ONLINE"}', decimals=0, color_mode="none",
             desc="Checked in within the last 12 minutes."),
        stat("Agents offline", 'techpioasset_agents{job="pioassets-api",env="$env",status="OFFLINE"}', decimals=0,
             thresholds=[(1, "orange")]),
        stat("Needs reinstall", 'techpioasset_agents{job="pioassets-api",env="$env",status="CREDENTIAL_REJECTED"}', decimals=0,
             thresholds=[(1, "red")]),
        stat("Refresh pending", 'techpioasset_agent_refresh_pending{job="pioassets-api",env="$env"}', decimals=0, color_mode="none"),
        stat("Gauges age", 'time() - techpioasset_fleet_gauges_refreshed_timestamp_seconds{job="pioassets-api",env="$env"}', "s",
             thresholds=[(180, "orange"), (600, "red")], decimals=0, desc="Seconds since the API last recomputed these numbers. Normally under 90."),
        timeseries("Agents by status", [
            ('techpioasset_agents{job="pioassets-api",env="$env"}', "{{status}}"),
        ], "short", stack=True, minimum=0),
        bargauge("Assets by status (live records)", 'techpioasset_assets{job="pioassets-api",env="$env"} > 0'),
        timeseries("Microsoft 365 connections by last sync result", [
            ('techpioasset_m365_connections{job="pioassets-api",env="$env"}', "{{status}}"),
        ], "short", stack=True, minimum=0),
        timeseries("Fleet gauge refresh failures", [
            ('increase(techpioasset_fleet_gauge_refresh_failures_total{job="pioassets-api",env="$env"}[1h])', "failures / h"),
        ], "short", minimum=0),
    ],
    variables=[env_variable()],
    tags=["api"],
    description="Request rates, latency and errors by route; Node process health; and the fleet counts.",
)

POSTGRES = dashboard(
    "pa-postgres",
    "Postgres",
    [
        stat("Up", 'pg_up{job="postgres",env="$env"}', thresholds=[(0, "red"), (1, "green")]),
        stat("Connections", 'sum(pg_stat_activity_count{job="postgres",env="$env"})', decimals=0,
             thresholds=[(60, "orange"), (80, "red")]),
        stat("Of max", 'sum(pg_stat_activity_count{job="postgres",env="$env"}) / max(pg_settings_max_connections{job="postgres",env="$env"})',
             "percentunit", thresholds=[(0.6, "orange"), (0.8, "red")], decimals=0),
        stat("Database size", 'sum(pg_database_size_bytes{job="postgres",env="$env",datname!~"template.*|postgres"})', "bytes", decimals=1, color_mode="none"),
        stat("Cache hit", 'sum(rate(pg_stat_database_blks_hit{job="postgres",env="$env"}[10m])) / (sum(rate(pg_stat_database_blks_hit{job="postgres",env="$env"}[10m])) + sum(rate(pg_stat_database_blks_read{job="postgres",env="$env"}[10m])))',
             "percentunit", thresholds=[(0, "red"), (0.9, "orange"), (0.98, "green")], decimals=1,
             desc="Share of reads served from memory. Below 98% on a database this size means it is short of RAM or a query is scanning tables."),
        stat("Deadlocks (24 h)", 'sum(increase(pg_stat_database_deadlocks{job="postgres",env="$env"}[24h]))', decimals=0,
             thresholds=[(1, "red")]),
        timeseries("Connections by state", [
            ('sum by (state) (pg_stat_activity_count{job="postgres",env="$env"})', "{{state}}"),
        ], "short", stack=True, minimum=0),
        timeseries("Transactions / s", [
            ('sum(rate(pg_stat_database_xact_commit{job="postgres",env="$env"}[5m]))', "commit"),
            ('sum(rate(pg_stat_database_xact_rollback{job="postgres",env="$env"}[5m]))', "rollback"),
        ], "ops", minimum=0),
        timeseries("Rows", [
            ('sum(rate(pg_stat_database_tup_returned{job="postgres",env="$env"}[5m]))', "scanned"),
            ('sum(rate(pg_stat_database_tup_fetched{job="postgres",env="$env"}[5m]))', "fetched"),
            ('sum(rate(pg_stat_database_tup_inserted{job="postgres",env="$env"}[5m]))', "inserted"),
            ('sum(rate(pg_stat_database_tup_updated{job="postgres",env="$env"}[5m]))', "updated"),
            ('sum(rate(pg_stat_database_tup_deleted{job="postgres",env="$env"}[5m]))', "deleted"),
        ], "ops", minimum=0),
        timeseries("Database size", [
            ('pg_database_size_bytes{job="postgres",env="$env",datname!~"template.*|postgres"}', "{{datname}}"),
        ], "bytes", minimum=0),
        timeseries("Longest running transaction", [
            ('max(pg_stat_activity_max_tx_duration{job="postgres",env="$env"})', "longest open transaction"),
        ], "s", minimum=0, desc="A transaction open for minutes blocks vacuum and, under RLS, holds a tenant lock."),
        timeseries("Temp files written", [
            ('sum(rate(pg_stat_database_temp_bytes{job="postgres",env="$env"}[5m]))', "temp bytes / s"),
        ], "Bps", minimum=0, desc="Sorts and hashes that did not fit in work_mem. Steady non-zero means a query needs an index."),
    ],
    variables=[env_variable()],
    tags=["postgres"],
    description="The PioAssets databases, as seen by postgres_exporter through the read-only monitor role.",
)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    for d in (HOST, CONTAINERS, API, POSTGRES):
        path = OUT / f"{d['uid']}.json"
        path.write_text(json.dumps(d, indent=2) + "\n", encoding="utf-8")
        print(f"wrote {path.relative_to(Path(__file__).parent.parent)} ({len(d['panels'])} panels)")


if __name__ == "__main__":
    main()
