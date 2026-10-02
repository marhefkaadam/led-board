"use strict";
const SETTINGS = {
    "prefix": "https://api.golemio.cz/v2/pid/departureboards/?",
    "httpTimeout": 20
}

const PARAMETERS = {
    "airCondition": true,
    "aswIds": ["539"],
    "filter": "none",
    "limit": 8,
    "skip": "atStop",
    "minutesAfter": 999
}

const dayOfWeek = ["Neděle", "Pondělí", "Úterý", "Středa", "Čtvrtek", "Pátek", "Sobota"];
const AFTER_MINUTES_THRESHOLD = 45;

// Parse URL params manually to support repeated keys
let searchString = new URLSearchParams(document.location.search);

let aswIds = searchString.getAll("aswIds[]");
if (aswIds.length === 0) aswIds = searchString.getAll("aswIds");
if (aswIds.length === 0) aswIds = PARAMETERS.aswIds;

const filter = PARAMETERS.filter;
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
let displayedStopCount = aswIds.length;

function getData() {
    const fetches = aswIds.map(id => fetchStop(id).then(data => ({id, data})));
    Promise.all(fetches)
        .then(results => {
            initialLoadDone = true;
            updateContent(mergeStopResponses(results));
        })
        .catch((err) => {
            console.error('Failed to fetch:', err);
            if (initialLoadDone) fullScreenMessage();
            // on first load failure, silently retry on next timer tick
        });
}

function aswNodeId(aswId) {
    return String(aswId).split("_")[0];
}

function mergeStopResponses(results) {
    const grouped = new Map();
    results.forEach(({id, data}) => {
        const nodeId = aswNodeId(id);
        if (!grouped.has(nodeId)) {
            grouped.set(nodeId, {
                stops: new Map(),
                departures: [],
                departureKeys: new Set()
            });
        }
        const group = grouped.get(nodeId);
        data.stops.forEach(stop => group.stops.set(stop.stop_id, stop));
        data.departures.forEach(departure => {
            const key = departure.id || JSON.stringify(departure);
            if (!group.departureKeys.has(key)) {
                group.departureKeys.add(key);
                group.departures.push(departure);
            }
        });
    });
    const nonEmptyGroups = [...grouped.values()].filter(group => group.departures.length > 0);
    displayedStopCount = nonEmptyGroups.length;
    return nonEmptyGroups.map(group => ({
        stops: [...group.stops.values()],
        departures: group.departures
    }));
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

function platformCode(group) {
    return group.departures.find(departure => departure.stop?.platform_code)?.stop.platform_code
        || group.stop.platform_code
        || "";
}

function logoForRouteTypes(routeTypes) {
    if (routeTypes.has(1)) return ["Metro_Prague_logo.svg", "Metro"];
    if (routeTypes.has(2)) return ["Prague_train_logo.svg", "Train"];
    return null;
}

function comparePlatformCodes(first, second) {
    const firstCode = String(first || "").trim().toUpperCase();
    const secondCode = String(second || "").trim().toUpperCase();
    const firstParts = firstCode.match(/(\D*)(\d*)/);
    const secondParts = secondCode.match(/(\D*)(\d*)/);
    const lettersOrder = firstParts[1].localeCompare(secondParts[1], "en");
    if (lettersOrder !== 0) return lettersOrder;
    const firstNumber = firstParts[2] === "" ? -1 : Number(firstParts[2]);
    const secondNumber = secondParts[2] === "" ? -1 : Number(secondParts[2]);
    if (firstNumber !== secondNumber) return firstNumber - secondNumber;
    return firstCode.localeCompare(secondCode, "en");
}

function compareDisplayGroups(first, second) {
    if (first.transitType !== null || second.transitType !== null) {
        if (first.transitType === null) return 1;
        if (second.transitType === null) return -1;
        if (first.transitType !== second.transitType) {
            return first.transitType - second.transitType;
        }
        if (first.transitType === 2) {
            const firstPlatform = String(first.transitLine || "").trim();
            const secondPlatform = String(second.transitLine || "").trim();
            if (!firstPlatform) return 1;
            if (!secondPlatform) return -1;
            return comparePlatformCodes(firstPlatform, secondPlatform);
        }
        return first.transitLine.localeCompare(second.transitLine);
    }
    return comparePlatformCodes(platformCode(first), platformCode(second));
}

function buildDisplayGroups(stopGroups) {
    const displayGroups = [];
    const transitGroups = new Map();

    stopGroups.forEach(group => {
        const regularDepartures = [];
        group.departures.forEach(departure => {
            const routeType = departure.route?.type;
            if (routeType === 1 || routeType === 2) {
                const line = String(departure.route?.short_name || "");
                const departurePlatform = String(departure.stop?.platform_code || "").trim();
                const transitGroupKey = routeType === 2
                    ? departurePlatform
                    : line;
                const key = `${routeType}:${transitGroupKey}`;
                if (!transitGroups.has(key)) {
                    const transitGroup = {
                        stop: group.stop,
                        departures: [],
                        transitType: routeType,
                        transitLine: routeType === 2 ? departurePlatform : line
                    };
                    transitGroups.set(key, transitGroup);
                    displayGroups.push(transitGroup);
                }
                transitGroups.get(key).departures.push(departure);
            } else {
                regularDepartures.push(departure);
            }
        });
        if (regularDepartures.length > 0) {
            displayGroups.push({
                stop: group.stop,
                departures: regularDepartures,
                transitType: null,
                transitLine: ""
            });
        }
    });
    return displayGroups.sort(compareDisplayGroups);
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

        const stopsWithDepartures = buildDisplayGroups(
            [...stopMap.values()].filter(g => g.departures.length > 0));

        stopsWithDepartures.forEach((group, groupIndex) => {
            const {stop, departures} = group;
            if (groupIndex > 0) {
                const spacer = document.createElement("tr");
                const spacerCell = document.createElement("td");
                spacerCell.colSpan = 5;
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
                    if (group.transitType === 2) {
                        platformCell.classList.add("train-platform-label");
                    }
                    const logo = group.transitType === null
                        ? null
                        : logoForRouteTypes(new Set([group.transitType]));
                    if (logo) {
                        const transitLogo = document.createElement("img");
                        transitLogo.className = group.transitType === 2
                            ? "metro-logo train-logo"
                            : "metro-logo";
                        transitLogo.src = logo[0];
                        transitLogo.alt = logo[1];
                        platformCell.appendChild(transitLogo);
                        if (group.transitType === 2) {
                            const trainPlatform = departures.find(departure =>
                                departure.stop?.platform_code
                            )?.stop.platform_code;
                            if (trainPlatform) {
                                const platformNumber = document.createElement("span");
                                platformNumber.className = "train-platform";
                                platformNumber.textContent = trainPlatform;
                                platformCell.appendChild(platformNumber);
                            }
                        }
                    } else {
                        platformCell.textContent = platformCode({stop, departures});
                    }
                    tr.appendChild(platformCell);
                }

                const route = document.createElement("td");
                route.classList.add("route");
                route.textContent = row.route.short_name;
                tr.appendChild(route);

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
                const minutes = row.departure_timestamp?.minutes;
                const minutesNum = parseInt(minutes);
                if (!isNaN(minutesNum) && minutesNum > AFTER_MINUTES_THRESHOLD) {
                    // Parse the scheduled or predicted timestamp and format as H:MM
                    const timestamp = row.departure_timestamp.predicted ?? row.departure_timestamp.scheduled;
                    if (timestamp) {
                        const date = new Date(timestamp);
                        const h = date.getHours().toString().padStart(2, '0');
                        const m = date.getMinutes().toString().padStart(2, '0');
                        arrival.textContent = `${h}:${m}`;
                    } else {
                        arrival.textContent = minutes ?? '';
                    }
                } else {
                    arrival.textContent = minutes ?? '';
                }
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

    const scaleX = window.innerWidth / (384 * displayedStopCount);
    const naturalHeight = board.scrollHeight;
    const scaleY = window.innerHeight / naturalHeight;
    const scale = Math.min(scaleX, scaleY);

    board.style.transform = `scale(${scale})`;
    board.style.height = `${window.innerHeight / scale}px`;
    board.style.width = `${384 * displayedStopCount}px`;
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