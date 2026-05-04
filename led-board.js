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

    // Deduplicate stop names for the top header
    const uniqueNames = [...new Set(data.stops.map(s => s.stop_name))];
    const stationName = document.getElementById("station-name");
    if (stationName) {
        stationName.textContent = uniqueNames.join(' / ');
    }

    // Group departures by stop_id
    const stopMap = new Map();
    data.stops.forEach(stop => stopMap.set(stop.stop_id, { stop, departures: [] }));
    data.departures.forEach(dep => {
        const group = stopMap.get(dep.stop.id);
        if (group) group.departures.push(dep);
    });

    // Count how many stops actually have departures
    const stopsWithDepartures = [...stopMap.values()].filter(g => g.departures.length > 0);

    stopMap.forEach(({ stop, departures }) => {
        if (departures.length === 0) return;

        // Show platform header only if there are multiple platforms with departures
        if (stopsWithDepartures.length > 1) {
            const stopHeader = document.createElement("div");
            stopHeader.classList.add("stop-header");
            stopHeader.textContent = `Nástupiště ${stop.platform_code}`;
            main.appendChild(stopHeader);
        }

        departures.forEach(row => {
            const departure = document.createElement("div");
            departure.classList.add("row", "departure");

            const route = document.createElement("div");
            route.classList.add("route");
            route.textContent = row.route.short_name;
            departure.appendChild(route);

            const accessible = document.createElement("div");
            accessible.classList.add("accessible");
            if (row.trip.is_wheelchair_accessible) {
                const wheelchair = document.createElement("img");
                wheelchair.setAttribute("src", "accessible.svg");
                accessible.appendChild(wheelchair);
            }
            departure.appendChild(accessible);

            const airCondition = document.createElement("div");
            airCondition.classList.add("aircondition");
            if (row.trip.is_air_conditioned) {
                const aircondition = document.createElement("img");
                aircondition.setAttribute("src", "snowflake.svg");
                airCondition.appendChild(aircondition);
            }
            departure.appendChild(airCondition);

            const headsign = document.createElement("div");
            headsign.classList.add("headsign");
            headsign.textContent = row.trip.headsign;
            departure.appendChild(headsign);

            const arrival = document.createElement("div");
            arrival.classList.add("arrival");
            arrival.textContent = row.departure_timestamp.minutes;
            departure.appendChild(arrival);

            main.appendChild(departure);
        });
    });

    scaleBoard();
}

function updateClock(){
  const now = new Date();
  const date = dayOfWeek[now.getDay()] +
  " " +
  now.getDate().toString().padStart(2,"0") +
  ".&thinsp;" +
  now.getMonth().toString().padStart(2,"0") +
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
