export async function runDemoModel() {
  // Simulate model delay
  await new Promise(resolve => setTimeout(resolve, 800));

  return {
    Acousticness: (Math.random()).toFixed(2),
    Energy: (Math.random()).toFixed(2),
    Danceability: (Math.random()).toFixed(2),
    Valence: (Math.random()).toFixed(2),
    Instrumentalness: (Math.random()).toFixed(2)
  };
}
