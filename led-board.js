"use strict";
const SETTINGS = {
    "prefix": "https://api.golemio.cz/v2/pid/departureboards/?",
    "httpTimeout": 20
}

const PARAMETERS = {
    "airCondition": true,
    "aswIds": ["539_1"],
    "filter": "routeHeadingOnce",
    "limit": 5,
    "skip": "atStop",
    "minutesAfter": 99
}

const dayOfWeek = ["Neděle", "Pondělí", "Úterý", "Středa", "Čtvrtek", "Pátek", "Sobota"];

// Parse URL params manually to support repeated keys
let searchString = new URLSearchParams(document.location.search);

let aswIds = searchString.getAll("aswIds[]");
if (aswIds.length === 0) aswIds = searchString.getAll("aswIds");
if (aswIds.length === 0) aswIds = PARAMETERS.aswIds;

const filter = searchString.get("filter") ?? PARAMETERS.filter;
const limit = searchString.get("limit") ?? PARAMETERS.limit;
const minutesAfter = searchString.get("minutesAfter") ?? PARAMETERS.minutesAfter;
const airCondition = searchString.get("airCondition") ?? PARAMETERS.airCondition;
const skip = searchString.get("skip") ?? PARAMETERS.skip;

// Fetch data for all aswIds — one request per stop
function buildQueryString(aswId) {
    const params = new URLSearchParams({
        airCondition,
        aswIds: aswId,
        filter,
        limit,
        skip,
        minutesAfter
    });
    return params.toString();
}

let initialLoadDone = false;

function getData() {
    const fetches = aswIds.map(id => fetchStop(id));
    Promise.all(fetches)
        .then(results => {
            initialLoadDone = true;
            updateContent(results);
        })
        .catch((err) => {
            console.error('Failed to fetch:', err);
            if (initialLoadDone) fullScreenMessage();
            // on first load failure, silently retry on next timer tick
        });
}

function fetchStop(aswId) {
    return new Promise((resolve, reject) => {
        const httpRequest = new XMLHttpRequest();
        httpRequest.timeout = SETTINGS.httpTimeout * 1000;
        httpRequest.open("GET", SETTINGS.prefix + buildQueryString(aswId));
        httpRequest.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
        httpRequest.setRequestHeader('x-access-token', KEY);
        httpRequest.onreadystatechange = function () {
            if (this.readyState !== 4) return;  // wait until fully done
            if (httpRequest.status === 200) {
                resolve(JSON.parse(this.responseText));
            } else {
                reject(new Error(`HTTP ${httpRequest.status}`));
            }
        };
        httpRequest.ontimeout = () => reject(new Error('timeout'));
        httpRequest.onerror = () => reject(new Error('network error'));
        httpRequest.send();
    });
}

function updateContent(dataArray) {
    const container = document.getElementById("stops-container");
    container.replaceChildren();

    dataArray.forEach((data) => {
        const section = document.createElement("div");
        section.classList.add("stop-section");

        // Station name header
        const uniqueNames = [...new Set(data.stops.map(s => s.stop_name))];
        const nameEl = document.createElement("div");
        nameEl.classList.add("station-name");
        nameEl.textContent = uniqueNames.join(' / ');
        section.appendChild(nameEl);

        // Build table
        const table = document.createElement("table");
        table.style.width = "100%";
        table.style.borderCollapse = "collapse";

        const stopMap = new Map();
        data.stops.forEach(stop => stopMap.set(stop.stop_id, { stop, departures: [] }));
        data.departures.forEach(dep => {
            const group = stopMap.get(dep.stop.id);
            if (group) group.departures.push(dep);
        });

        const stopsWithDepartures = [...stopMap.values()].filter(g => g.departures.length > 0);

        stopsWithDepartures.forEach(({ stop, departures }, groupIndex) => {
            if (groupIndex > 0) {
                const spacer = document.createElement("tr");
                const spacerCell = document.createElement("td");
                spacerCell.colSpan = 6;
                spacerCell.style.padding = "4px 0";
                spacer.appendChild(spacerCell);
                table.appendChild(spacer);
            }

            departures.forEach((row, rowIndex) => {
                const tr = document.createElement("tr");

                if (rowIndex === 0) {
                    const platformCell = document.createElement("td");
                    platformCell.rowSpan = departures.length;
                    platformCell.classList.add("platform-label");
                    platformCell.textContent = stop.platform_code;
                    tr.appendChild(platformCell);
                }

                const route = document.createElement("td");
                route.classList.add("route");
                route.textContent = row.route.short_name;
                tr.appendChild(route);

                const accessible = document.createElement("td");
                accessible.classList.add("accessible");
                if (row.trip.is_wheelchair_accessible) {
                    const wheelchair = document.createElement("img");
                    wheelchair.setAttribute("src", "accessible.svg");
                    accessible.appendChild(wheelchair);
                }
                tr.appendChild(accessible);

                const airConditionCell = document.createElement("td");
                airConditionCell.classList.add("aircondition");
                if (row.trip.is_air_conditioned) {
                    const aircondition = document.createElement("img");
                    aircondition.setAttribute("src", "snowflake.svg");
                    airConditionCell.appendChild(aircondition);
                }
                tr.appendChild(airConditionCell);

                const headsign = document.createElement("td");
                headsign.classList.add("headsign");
                headsign.textContent = row.trip.headsign;
                tr.appendChild(headsign);

                const arrival = document.createElement("td");
                arrival.classList.add("arrival");
                arrival.textContent = row.departure_timestamp.minutes;
                tr.appendChild(arrival);

                table.appendChild(tr);
            });
        });

        section.appendChild(table);
        container.appendChild(section);
    });

    scaleBoard();
}

function scaleBoard() {
    const board = document.getElementById('board');
    board.style.transform = 'none';
    board.style.height = 'auto';

    const scaleX = window.innerWidth / (384 * aswIds.length);
    const naturalHeight = board.scrollHeight;
    const scaleY = window.innerHeight / naturalHeight;
    const scale = Math.min(scaleX, scaleY);

    board.style.transform = `scale(${scale})`;
    board.style.height = `${window.innerHeight / scale}px`;
    board.style.width = `${384 * aswIds.length}px`;
}

function updateClock() {
    const now = new Date();
    const date = dayOfWeek[now.getDay()] +
        " " +
        now.getDate().toString().padStart(2, "0") +
        ".&thinsp;" +
        (now.getMonth() + 1).toString().padStart(2, "0") +
        ".&thinsp;" +
        now.getFullYear().toString().padStart(2, "0");
    const hours = now.getHours().toString().padStart(2, "0");
    const minutes = now.getMinutes().toString().padStart(2, "0");
    document.getElementById("date").innerHTML = date;
    document.getElementById("hours").textContent = hours;
    document.getElementById("minutes").textContent = minutes;
}

function fullScreenMessage(content = "Chyba připojení") {
    const container = document.getElementById("stops-container");
    container.replaceChildren();
    const msg = document.createElement("div");
    msg.classList.add("error-message");
    msg.textContent = content;
    container.appendChild(msg);
}

getData();
updateClock();

const getDataTimer = setInterval(getData, 20000);
const updateClockTimer = setInterval(updateClock, 1000);

window.addEventListener('resize', scaleBoard);