import showError from './showError.js';
import { showAlert } from './alert.js';
import { removeProgress, showProgress } from './showProgressBtn.js';

const emailIn = document.getElementById('email');
const btnLoginNow = document.querySelector('.btn-loginnow');

export default async function (e) {
  e.preventDefault();

  const modalEmail = new bootstrap.Modal(document.getElementById('modal-resetlink'));
  try {
    const email = emailIn.value;

    showProgress(btnLoginNow);

    await axios.post('/api/v1/users/forgotpassword', { email });
    removeProgress(btnLoginNow, 'Email Sent');
    showAlert('success', 'We have sent a reset link to your email.');
    modalEmail.show();

    setTimeout(() => {
      modalEmail.hide();
      location.assign('/');
    }, 4000);
  } catch (err) {
    showError(err, btnLoginNow, 'Send Email');
  }
}
