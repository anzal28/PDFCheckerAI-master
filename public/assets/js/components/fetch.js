const API_KEY = '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';
const API_ENDPOINT = 'https://api.openai.com/v1/completions';
//this function is responsible for API request with openAI backend-with endpoint of completions
async function generateText(prompt) {
  const response = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      prompt: prompt,
      max_tokens: 200,
      model: 'text-davinci-003',
      // n: 1,
      //stop: '\n',
      temperature: 0.7,
    }),
  });
  const dataone = await response.json();
  const { choices } = dataone;
  return choices[0].text;
}

export default generateText;
