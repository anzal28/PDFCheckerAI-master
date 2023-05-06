import showError from './showError.js';
import { showAlert } from './alert.js';
import { removeProgress, showProgress } from './showProgressBtn.js';

const currentPasswordIn = document.getElementById('current-password');
const passwordIn = document.getElementById('password');
const passwordConfirmIn = document.getElementById('password-confirm');
const btnUpdatePass = document.querySelector('.btn-updatePassword');

export default async function (e) {
  try {
    e.preventDefault();
    const currentPassword = currentPasswordIn.value.trim();
    const password = passwordIn.value.trim();
    const passwordConfirm = passwordConfirmIn.value.trim();

    if (!currentPassword || !password || !passwordConfirm)
      return showAlert('danger', 'Fields can not be empity.');

    showProgress(btnUpdatePass);
    await axios.patch('/api/v1/users/updatepassword', {
      currentPassword,
      password,
      passwordConfirm,
    });

    showAlert('success', 'Password update successful!');
    removeProgress(btnUpdatePass, 'Updated');

    setTimeout(() => {
      location.assign('/');
    }, 3000);
  } catch (err) {
    showError(err, btnUpdatePass, 'Update Passowrd');
  }
}
