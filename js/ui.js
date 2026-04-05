const features = [
  "Acousticness",
  "Energy",
  "Danceability",
  "Valence",
  "Instrumentalness"
];

export function renderFeatures() {
  const list = document.getElementById("features-list");

  features.forEach(feature => {
    const li = document.createElement("li");
    li.textContent = feature;
    list.appendChild(li);
  });
}

export function renderResults(data) {
  const resultsDiv = document.getElementById("results");

  resultsDiv.innerHTML = `
    <h2>Predicted Values</h2>
    <ul>
      ${Object.entries(data)
        .map(([key, value]) => `<li>${key}: ${value}</li>`)
        .join("")}
    </ul>
  `;
}
