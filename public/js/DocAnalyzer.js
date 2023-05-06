//import
import generateResult from './fetch.js';
import { showProgress, removeProgress } from './showProgressBtn.js';
import showError from './showError.js';
import { showAlert } from './alert.js';

const output = document.querySelector('#output');
const loader = document.querySelector('.loader');

export async function analyzePdf(e) {
  e.preventDefault();
  const btnAnalyze = document.getElementById('submit-btn');

  const name = document.getElementById('doc-title')?.value.trim();
  const country = document.getElementById('doc-country')?.value.trim();
  const product = document.getElementById('doc-product')?.value.trim();
  const intent = document.getElementById('doc-intent')?.value.trim();
  const audiance = document.getElementById('doc-audiance')?.value.trim();
  const dissemination = document.getElementById('doc-dissemination')?.value.trim();

  const dataTobeSent = {
    name,
    country,
    product,
    intent,
    audiance,
    dissemination,
  };

  fetchAndDisplay({
    dataTobeSent,
    btn: btnAnalyze,
    btnMessage: 'Analyse',
    endpoint: 'check-compliance',
  });

  // Read File And Analyze
  // const file = document.querySelector('#file').files[0];
  // const fileReader = new FileReader();

  // fileReader.onload = async function () {
  //   try {
  //     resultHeader?.remove();
  //     loader.style.display = 'block';
  //     showProgress(btnAnalyze);
  //     const text =
  //       file.type === 'application/pdf'
  //         ? await extractTextFromPdf(file)
  //         : await extractTextFromTxt(file);

  //         const dataTobeSent = {
  //           text,
  //           name,
  //           country,
  //           product,
  //           intent,
  //           audiance,
  //           dissemination,
  //         };
  //     const { data } = await generateResult({
  //       dataTobeSent,
  //       method: 'post',
  //       url: '/api/v1/processpdf/check-compliance',
  //     });

  //     // Progress Indicators
  //     removeProgress(btnAnalyze, 'Done');
  //     showAlert('success', 'Successful on analyzing your document!');
  //     loader.style.display = 'none';

  //     //Analyzed response
  //     output.textContent = data;

  //     setTimeout(() => {
  //       btnAnalyze.textContent = 'Analyze';
  //     }, 1000);
  //   } catch (err) {
  //     showError(err, btnAnalyze, 'TryAgain');
  //   }
  // };
  // fileReader.readAsArrayBuffer(file);
}

export async function checkReference(e) {
  e.preventDefault();

  const btnCheck = document.getElementById('submit-btn');
  fetchAndDisplay({ btn: btnCheck, btnMessage: 'Check', endpoint: 'check-references' });
}

// //////////// //
//    HELPERS   //
// /////////// //

async function fetchAndDisplay({ dataTobeSent = {}, endpoint, btn, btnMessage }) {
  const file = document.querySelector('#file').files[0];
  const fileReader = new FileReader();
  const resultHeader = document.querySelector('.result-section');

  fileReader.onload = async function () {
    try {
      resultHeader?.remove();
      loader.style.display = 'block';
      showProgress(btn);
      const text =
        file.type === 'application/pdf'
          ? await extractTextFromPdf(file)
          : await extractTextFromTxt(file);

      dataTobeSent.text = text;

      const { data } = await generateResult({
        dataTobeSent,
        method: 'post',
        url: `/api/v1/processpdf/${endpoint}`,
      });

      // Progress Indicators
      removeProgress(btn, 'Done');
      showAlert('success', 'Successful on analyzing your document!');
      loader.style.display = 'none';

      //Analyzed response
      output.textContent = data;

      setTimeout(() => {
        btn.textContent = btnMessage;
      }, 1000);
    } catch (err) {
      showError(err, btn, 'TryAgain');
    }
  };
  fileReader.readAsArrayBuffer(file);
}

async function extractTextFromPdf(file) {
  const typedArray = new Uint8Array(await file.arrayBuffer());
  const pdfDocument = await pdfjsLib.getDocument({ data: typedArray }).promise;

  const textContent = [];

  for (let i = 1; i <= pdfDocument.numPages; i++) {
    const page = await pdfDocument.getPage(i);
    textContent.push(await page.getTextContent());
  }

  const text = textContent.map((content) => {
    return content.items.map((item) => item.str).join('');
  });
  return text.join('');
}

async function extractTextFromTxt(file) {
  const text = await file.text();
  return text;
}
