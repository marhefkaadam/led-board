"use strict";
const SETTINGS = {
  "prefix" : "https://api.golemio.cz/v2/pid/departureboards/?", // Base URL
  "httpTimeout" : 20
}

// Default settings of URL parameters
const PARAMETERS = {
  "airCondition" : true,
  "aswIds" : "539_1",
  "filter" : "routeHeadingOnce",
  "limit" : 5,
  "skip" : "atStop",
  "minutesAfter" : 99
}

// Dictionary of week days
const dayOfWeek = ["Neděle","Pondělí","Úterý","Středa","Čtvrtek","Pátek","Sobota"];

// Make a copy of parameters which can be edited
let parameters = PARAMETERS;

// Lock it so no unauthorized values cannot be added
Object.seal(parameters);

// Get URL parameters
let searchString = new URLSearchParams(document.location.search);
for (const [key, value] of searchString){
  parameters[key] = value;
}

// Assure that user input is correct, if not, replace with default values
if (!["true","false"].includes(parameters.airCondition)) parameters.airCondition = PARAMETERS.airCondition;
if (!/^[1-9][0-9]{0,4}(_\d{1,3})?$/.test(parameters.aswIds)) parameters.aswIds = PARAMETERS.aswIds;
if (!["none", "routeOnce", "routeHeadingOnce", "routeOnceFill", "routeHeadingOnceFill", "routeHeadingOnceNoGap", "routeHeadingOnceNoGapFill"].includes(parameters.filter)) parameters.filter = PARAMETERS.filter;
if (parameters.limit <= 0 && parameters.limit >= 8) parameters.limit = PARAMETERS.limit;

// Construct query string
const queryString = new URLSearchParams(parameters).toString();

// Fill table with content for the first time
getData(queryString);
updateClock();

function getData(queryString) {
  try {
    const httpRequest = new XMLHttpRequest();
    httpRequest.timeout = SETTINGS.httpTimeout * 1000; // should be miliseconds by spec
    httpRequest.open("GET", SETTINGS.prefix + queryString);
    httpRequest.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
    httpRequest.setRequestHeader('x-access-token', KEY);
    httpRequest.onreadystatechange = function () {
      // ReadyState 4 = done, HTTP 200 = OK
      if (this.readyState === 4 && httpRequest.status === 200) {
        // Continue on success (200) or process errors
        let data = JSON.parse(this.responseText);
        // If data succesfully arrived, replace the local time (which could be incorrect) with server time
        updateContent(data);
      }
      else {
        fullScreenMessage()
      }
      httpRequest.ontimeout = function() {
        fullScreenMessage();
      }
      httpRequest.onerror = function () {
        fullScreenMessage();
      }
    }
    httpRequest.send();
  }
  catch(e){
    fullScreenMessage();
  }
}

// Create rows with departures and insert them into document
function updateContent(data) {
    const main = document.getElementsByTagName("main")[0];
    main.replaceChildren();

    const uniqueNames = [...new Set(data.stops.map(s => s.stop_name))];
    const stationName = document.getElementById("station-name");
    if (stationName) {
        stationName.textContent = uniqueNames.join(' / ');
    }

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
    // const multiPlatform = stopsWithDepartures.length > 1;  // Show platform column only if there are multiple platforms with departures
    const multiPlatform = true; // Always show platform column, even if there is only one platform with departures

    stopsWithDepartures.forEach(({ stop, departures }, groupIndex) => {
        // Add spacer row between platforms
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

            // Platform label cell — only on first row, spans all departure rows
            if (multiPlatform && rowIndex === 0) {
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

            const airCondition = document.createElement("td");
            airCondition.classList.add("aircondition");
            if (row.trip.is_air_conditioned) {
                const aircondition = document.createElement("img");
                aircondition.setAttribute("src", "snowflake.svg");
                airCondition.appendChild(aircondition);
            }
            tr.appendChild(airCondition);

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

    main.appendChild(table);
    scaleBoard();
}

function updateClock(){
  const now = new Date();
  const date = dayOfWeek[now.getDay()] +
  " " +
  now.getDate().toString().padStart(2,"0") +
  ".&thinsp;" +
  (now.getMonth() + 1).toString().padStart(2,"0") +
  ".&thinsp;" +
  now.getFullYear().toString().padStart(2,"0");
  const hours = now.getHours().toString().padStart(2,"0");
  const minutes = now.getMinutes().toString().padStart(2,"0");
  document.getElementById("date").innerHTML = date;
  document.getElementById("hours").textContent = hours;
  document.getElementById("minutes").textContent = minutes;
}

// Set fulscreen innformation text
function fullScreenMessage(content = "Chyba připojení") {
    const main = document.getElementsByTagName("main")[0];
    main.replaceChildren();

    const stationName = document.getElementById("station-name");
    if (stationName) stationName.textContent = '';

    const msg = document.createElement("div");
    msg.classList.add("error-message");
    msg.textContent = content;
    main.appendChild(msg);
}

// Timer for content updates 20 s
const getDataTimer = setInterval(function () {
  getData(queryString);
},20000);


// Timer for clock update 1 s
const updateClockTimer = setInterval(function () {
  updateClock();
},1000);

function scaleBoard() {
  document.body.style.transform = 'none';
  document.body.style.height = 'auto';

  const scaleX = window.innerWidth / 384;
  const naturalHeight = document.body.scrollHeight;
  const scaleY = window.innerHeight / naturalHeight;
  const scale = Math.min(scaleX, scaleY);

  document.body.style.transform = `scale(${scale})`;
  document.body.style.height = `${window.innerHeight / scale}px`;
}

scaleBoard();
window.addEventListener('resize', scaleBoard);
