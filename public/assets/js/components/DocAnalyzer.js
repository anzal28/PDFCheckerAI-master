//import
import generateText from './fetch.js';

const form = document.querySelector('form');
const output = document.querySelector('#output');
const loader = document.querySelector('.loader');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  loader.style.display = 'block';

  const file = document.querySelector('#file').files[0];
  const fileReader = new FileReader();
  fileReader.onload = async function () {
    const text =
      file.type === 'application/pdf'
        ? await extractTextFromPdf(file)
        : await extractTextFromTxt(file);
    // console.log(text);
    const prompt = `i want to analyze the following document and you must idetify what type of document it is  , the document text is ${text}`;
    const response = await generateText(prompt);

    //Analyzed response
    loader.style.display = 'none';
    output.textContent = response;
  };
  fileReader.readAsArrayBuffer(file);
});
async function extractTextFromPdf(file) {
  const typedArray = new Uint8Array(await file.arrayBuffer());
  const pdfDocument = await pdfjsLib.getDocument({ data: typedArray }).promise;
  const page = await pdfDocument.getPage(1);
  const textContent = await page.getTextContent();
  const text = textContent.items.map((item) => item.str).join('');
  return text;
}
async function extractTextFromTxt(file) {
  const text = await file.text();
  return text;
}
