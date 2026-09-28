"use strict";

const SETTINGS_DEFAULTS = {
    aswIds: ["539_1"],
    limit: "8",
    minutesAfter: "999"
};

const settingsButton = document.getElementById("settings-button");
const settingsDialog = document.createElement("dialog");
settingsDialog.id = "settings-dialog";
settingsDialog.innerHTML = `
    <form method="dialog" class="settings-panel">
        <div class="settings-header">
            <h1>Nastavení tabule</h1>
            <div class="settings-header-actions">
                <button type="button" class="settings-cancel">Zrušit</button>
                <button id="apply-settings" type="submit">Použít</button>
            </div>
        </div>
        <label for="stop-search">Zastávky</label>
        <div class="stop-search-row">
            <input id="stop-search" type="search" autocomplete="off"
                   placeholder="Hledat podle názvu nebo ID (minimálně 2 znaky)">
            <button id="locate-stop" type="button">Najít mě</button>
        </div>
        <div id="location-status" class="location-status"></div>
        <div id="nearest-stops" class="nearest-stops"></div>
        <div id="stop-suggestions" class="stop-suggestions" role="listbox"></div>
        <div id="selected-stops" class="selected-stops"></div>
        <p id="stop-status" class="settings-status" role="status"></p>
        <label for="settings-limit">Počet odjezdů</label>
        <div class="number-stepper">
            <button type="button" data-step-target="settings-limit" data-step="-1" aria-label="Méně odjezdů">-</button>
            <input id="settings-limit" type="number" min="1" max="99">
            <button type="button" data-step-target="settings-limit" data-step="1" aria-label="Více odjezdů">+</button>
        </div>
        <label for="settings-minutes">Minut od současnosti</label>
        <div class="number-stepper">
            <button type="button" data-step-target="settings-minutes" data-step="-10" aria-label="Méně minut">-</button>
            <input id="settings-minutes" type="number" min="1" max="9999">
            <button type="button" data-step-target="settings-minutes" data-step="10" aria-label="Více minut">+</button>
        </div>
    </form>
`;
document.body.appendChild(settingsDialog);

const searchInput = settingsDialog.querySelector("#stop-search");
const suggestions = settingsDialog.querySelector("#stop-suggestions");
const nearestStops = settingsDialog.querySelector("#nearest-stops");
const locationStatus = settingsDialog.querySelector("#location-status");
const selectedStops = settingsDialog.querySelector("#selected-stops");
const statusMessage = settingsDialog.querySelector("#stop-status");
const limitInput = settingsDialog.querySelector("#settings-limit");
const minutesInput = settingsDialog.querySelector("#settings-minutes");
let stopFeatures = [];
const featuresByNode = new Map();
let selected = [];
let stopDataPromise;

function currentParameters() {
    const params = new URLSearchParams(window.location.search);
    let ids = params.getAll("aswIds[]");
    if (ids.length === 0) ids = params.getAll("aswIds");
    return {
        aswIds: ids.length > 0 ? ids : SETTINGS_DEFAULTS.aswIds,
        limit: params.get("limit") || SETTINGS_DEFAULTS.limit,
        minutesAfter: params.get("minutesAfter") || SETTINGS_DEFAULTS.minutesAfter
    };
}

function featureId(feature) {
    const properties = feature.properties;
    return `${properties.asw_node_id}_${properties.asw_stop_id}`;
}

function featureLabel(feature) {
    const properties = feature.properties;
    const platform = properties.platform_code ? `, Platforma ${properties.platform_code}` : "";
    return `${properties.stop_name}${platform} (${featureId(feature)})`;
}

function normalizeSearchText(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase();
}

function compareAswIds(first, second) {
    const firstParts = first.split("_").map(Number);
    const secondParts = second.split("_").map(Number);
    for (let index = 0; index < Math.max(firstParts.length, secondParts.length); index++) {
        const firstPart = Number.isNaN(firstParts[index]) ? Infinity : firstParts[index];
        const secondPart = Number.isNaN(secondParts[index]) ? Infinity : secondParts[index];
        if (firstPart !== secondPart) return firstPart - secondPart;
    }
    return first.localeCompare(second);
}

function loadStops() {
    if (!stopDataPromise) {
        stopDataPromise = fetch("Zastavky_WGS84.json")
            .then(response => {
                if (!response.ok) throw new Error(`Could not load stops (${response.status})`);
                return response.json();
            })
            .then(data => {
                if (!data.features || !Array.isArray(data.features)) {
                    throw new Error("Stop data has an invalid format");
                }
                stopFeatures = data.features.sort((first, second) =>
                    compareAswIds(featureId(first), featureId(second)));
                stopFeatures.forEach(feature => {
                    const nodeId = String(feature.properties.asw_node_id);
                    const nodeFeatures = featuresByNode.get(nodeId) || [];
                    nodeFeatures.push(feature);
                    featuresByNode.set(nodeId, nodeFeatures);
                });
                return stopFeatures;
            });
    }
    return stopDataPromise;
}

function findFeature(id) {
    const normalized = id.replace("/", "_");
    return stopFeatures.find(feature => featureId(feature) === normalized);
}

function selectionForId(id) {
    const normalized = id.replace("/", "_");
    const exact = findFeature(normalized);
    if (exact) return {id: normalized, feature: exact};

    const nodeFeatures = featuresByNode.get(normalized) || [];
    if (nodeFeatures.length === 0) return null;
    const names = [...new Set(nodeFeatures.map(feature => feature.properties.stop_name))].join(" / ");
    return {id: normalized, feature: nodeFeatures[0], label: `${names} (${normalized})`};
}

function selectionLabel(item) {
    return item.label || featureLabel(item.feature);
}

function nodeLabel(nodeId, features) {
    const names = [...new Set(features.map(feature => feature.properties.stop_name))].join(" / ");
    return `${names} (${nodeId})`;
}

function renderSelected() {
    selectedStops.replaceChildren();
    selected.forEach(item => {
        const chip = document.createElement("span");
        chip.className = "selected-stop";
        chip.textContent = selectionLabel(item);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.setAttribute("aria-label", `Remove ${selectionLabel(item)}`);
        remove.textContent = "×";
        remove.addEventListener("click", () => {
            selected = selected.filter(selectedItem => selectedItem !== item);
            renderSelected();
        });
        chip.appendChild(remove);
        selectedStops.appendChild(chip);
    });
    nearestStops.querySelectorAll(".nearest-stop-group").forEach(group => {
        updateNearestStopHighlights(group, group.nearestStopData);
    });
}

function showNearestStops(stops) {
    nearestStops.replaceChildren();
    stops.forEach((stop, index) => {
        const group = document.createElement("div");
        group.className = "nearest-stop-group";
        group.nearestStopData = stop;
        const title = document.createElement("strong");
        title.textContent = `${stop.feature.properties.stop_name} (${Math.round(stop.distance)} m)`;
        group.appendChild(title);

        const wholeStop = document.createElement("button");
        wholeStop.type = "button";
        wholeStop.className = "nearest-stop-pill";
        wholeStop.textContent = "Všechny platformy";
        wholeStop.addEventListener("click", () => {
            const nodeId = String(stop.feature.properties.asw_node_id);
            selected = selected.filter(item =>
                String(item.feature.properties.asw_node_id) !== nodeId);
            selected.push({
                id: nodeId,
                feature: stop.feature,
                label: nodeLabel(nodeId, stop.nodeFeatures)
            });
            updateNearestStopHighlights(group, stop);
            renderSelected();
        });
        group.appendChild(wholeStop);

        stop.nodeFeatures.forEach(feature => {
            const platform = document.createElement("button");
            platform.type = "button";
            platform.className = "nearest-stop-pill";
            platform.textContent = `Platforma ${feature.properties.platform_code || feature.properties.asw_stop_id}`;
            platform.addEventListener("click", () => {
                const nodeId = String(feature.properties.asw_node_id);
                selected = selected.filter(item =>
                    item.id !== nodeId);
                if (!selected.some(item => item.id === featureId(feature))) {
                    selected.push({id: featureId(feature), feature});
                }
                updateNearestStopHighlights(group, stop);
                renderSelected();
            });
            group.appendChild(platform);
        });
        updateNearestStopHighlights(group, stop);
        nearestStops.appendChild(group);
    });
    nearestStops.classList.add("visible");
}

function updateNearestStopHighlights(group, stop) {
    const nodeId = String(stop.feature.properties.asw_node_id);
    const wholeStopSelected = selected.some(item => item.id === nodeId);
    const pills = [...group.querySelectorAll(".nearest-stop-pill")];
    pills[0].classList.toggle("chosen", wholeStopSelected);
    stop.nodeFeatures.forEach((feature, index) => {
        const platformSelected = selected.some(item => item.id === featureId(feature));
        pills[index + 1].classList.toggle("chosen", platformSelected);
    });
}

function renderSuggestions() {
    const query = normalizeSearchText(searchInput.value.trim());
    suggestions.replaceChildren();
    if (query.length < 2) return;

    const matches = stopFeatures.filter(feature => {
        const properties = feature.properties;
        return [properties.stop_name, properties.stop_id, properties.asw_node_id,
            properties.asw_stop_id, featureId(feature)]
            .some(value => normalizeSearchText(value).includes(query));
    });

    const matchingNodes = new Map();
    matches.forEach(feature => {
        const nodeId = String(feature.properties.asw_node_id);
        if (!matchingNodes.has(nodeId)) matchingNodes.set(nodeId, []);
        matchingNodes.get(nodeId).push(feature);
    });

    const options = [];
    matchingNodes.forEach((features, nodeId) => {
        const allNodeFeatures = featuresByNode.get(nodeId);
        options.push({
            type: "node",
            id: nodeId,
            feature: features[0],
            label: nodeLabel(nodeId, allNodeFeatures)
        });
        features.forEach(feature => options.push({
            type: "platform",
            id: featureId(feature),
            feature,
            label: featureLabel(feature)
        }));
    });

    options.slice(0, 50).forEach(optionData => {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "stop-suggestion";
        option.textContent = optionData.label;
        option.addEventListener("click", () => {
            if (optionData.type === "node") {
                selected = selected.filter(item =>
                    String(item.feature.properties.asw_node_id) !== optionData.id);
                selected.push({
                    id: optionData.id,
                    feature: optionData.feature,
                    label: optionData.label
                });
            } else if (!selected.some(item =>
                item.id === optionData.id ||
                item.id === String(optionData.feature.properties.asw_node_id))) {
                selected.push({id: optionData.id, feature: optionData.feature});
            }
            renderSelected();
        });
        suggestions.appendChild(option);
    });
    if (matches.length === 0) {
        const empty = document.createElement("div");
        empty.className = "settings-status";
        empty.textContent = "Žádné odpovídající zastávky";
        suggestions.appendChild(empty);
    }
}

function openSettings() {
    const parameters = currentParameters();
    limitInput.value = parameters.limit;
    minutesInput.value = parameters.minutesAfter;
    statusMessage.textContent = "Načítám zastávky...";
    nearestStops.replaceChildren();
    nearestStops.classList.remove("visible");
    locationStatus.replaceChildren();
    locationStatus.classList.remove("visible");
    selected = parameters.aswIds.map(selectionForId).filter(Boolean);
    renderSelected();
    settingsDialog.showModal();
    loadStops()
        .then(() => {
            selected = parameters.aswIds.map(selectionForId).filter(Boolean);
            renderSelected();
            statusMessage.textContent = "";
        })
        .catch(error => {
            locationStatus.replaceChildren();
            nearestStops.replaceChildren();
            nearestStops.classList.remove("visible");
            statusMessage.textContent = error.message;
        });
}

function applySettings(event) {
    event.preventDefault();
    if (selected.length === 0) {
        statusMessage.textContent = "Vyberte alespoň jednu zastávku.";
        return;
    }
    const current = new URLSearchParams(window.location.search);
    current.delete("aswIds");
    current.delete("aswIds[]");
    selected.forEach(item => current.append("aswIds", item.id));
    current.set("limit", limitInput.value);
    current.set("minutesAfter", minutesInput.value);
    current.delete("filter");
    window.location.href = `${window.location.pathname}?${current.toString()}`;
}

function distanceInMeters(latitude1, longitude1, latitude2, longitude2) {
    const earthRadius = 6371000;
    const latitudeDelta = (latitude2 - latitude1) * Math.PI / 180;
    const longitudeDelta = (longitude2 - longitude1) * Math.PI / 180;
    const a = Math.sin(latitudeDelta / 2) ** 2 +
        Math.cos(latitude1 * Math.PI / 180) * Math.cos(latitude2 * Math.PI / 180) *
        Math.sin(longitudeDelta / 2) ** 2;
    return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findNearestStop() {
    if (!navigator.geolocation) {
        statusMessage.textContent = "Tento prohlížeč nepodporuje určení polohy.";
        return;
    }
    const loadingStarted = Date.now();
    const loader = document.createElement("span");
    loader.className = "location-loader";
    loader.setAttribute("aria-label", "Zjišťuji vaši polohu");
    locationStatus.replaceChildren(loader, document.createTextNode(" Zjišťuji vaši polohu..."));
    locationStatus.classList.add("visible");
    navigator.geolocation.getCurrentPosition(position => {
        loadStops()
            .then(features => {
                const {latitude, longitude} = position.coords;
                const featuresByNode = new Map();
                features.forEach(feature => {
                    const nodeId = String(feature.properties.asw_node_id);
                    const nodeFeatures = featuresByNode.get(nodeId) || [];
                    nodeFeatures.push(feature);
                    featuresByNode.set(nodeId, nodeFeatures);
                });
                const nearestByNode = new Map();
                featuresByNode.forEach((nodeFeatures, nodeId) => {
                    nodeFeatures.forEach(feature => {
                        const [featureLongitude, featureLatitude] = feature.geometry.coordinates;
                        const distance = distanceInMeters(latitude, longitude, featureLatitude, featureLongitude);
                        const current = nearestByNode.get(nodeId);
                        if (!current || distance < current.distance) {
                            nearestByNode.set(nodeId, {feature, distance, nodeFeatures});
                        }
                    });
                });
                const nearest = [...nearestByNode.values()]
                    .sort((a, b) => a.distance - b.distance)
                    .slice(0, 2);
                    if (nearest.length === 0) {
                        locationStatus.replaceChildren();
                        locationStatus.classList.remove("visible");
                        statusMessage.textContent = "Všechny blízké zastávky jsou již vybrané.";
                        return;
                    }
                    const closestPlatform = nearest[0].feature;
                    selected = [{id: featureId(closestPlatform), feature: closestPlatform}];
                    renderSelected();
                    showNearestStops(nearest);
                    locationStatus.replaceChildren();
                    locationStatus.classList.remove("visible");
                    searchInput.value = "";
                    suggestions.replaceChildren();
                    statusMessage.textContent = "";
            })
            .catch(error => {
                locationStatus.replaceChildren();
                locationStatus.classList.remove("visible");
                statusMessage.textContent = error.message;
            });
    }, error => {
        const showError = () => {
            locationStatus.replaceChildren();
            locationStatus.classList.remove("visible");
        };
        const remainingLoadingTime = Math.max(0, 500 - (Date.now() - loadingStarted));
        window.setTimeout(showError, remainingLoadingTime);
        statusMessage.textContent = `Polohu se nepodařilo zjistit: ${error.message}`;
    }, {enableHighAccuracy: true, timeout: 10000});
}

settingsButton.addEventListener("click", openSettings);
settingsDialog.querySelector(".settings-cancel").addEventListener("click", () => settingsDialog.close());
settingsDialog.querySelector(".settings-panel").addEventListener("submit", applySettings);
settingsDialog.querySelector("#locate-stop").addEventListener("click", findNearestStop);
settingsDialog.querySelectorAll("[data-step-target]").forEach(button => {
    button.addEventListener("click", () => {
        const input = settingsDialog.querySelector(`#${button.dataset.stepTarget}`);
        const step = Number(button.dataset.step);
        const minimum = Number(input.min);
        const maximum = Number(input.max);
        const value = Math.min(maximum, Math.max(minimum, Number(input.value) + step));
        input.value = value;
    });
});
searchInput.addEventListener("input", () => {
    loadStops().then(renderSuggestions).catch(error => {
        statusMessage.textContent = error.message;
    });
});
