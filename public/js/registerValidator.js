import getElement from './getElement.js';
import { setAttributes } from './getElement.js';

const formEmail = getElement('#formEmail');
const formConfirmEmail = getElement('#formConfirmEmail');
const formPassword = getElement('#formPassword');
const formConfirmPassword = getElement('#formConfirmPassword');
const invalidEmail = getElement('.invalid-email');
const invalidPassword = getElement('.invalid-password');
const submitBtn = getElement('#loginBtn');

//Form validator bootstrap function
(function () {
  'use strict';
  window.addEventListener(
    'load',
    function () {
      // Fetch all the forms we want to apply custom Bootstrap validation styles to
      var forms = document.getElementsByClassName('needs-validation');

      // Loop over them and prevent submission
      var validation = Array.prototype.filter.call(forms, function (form) {
        form.addEventListener(
          'submit',
          function (event) {
            //  event.preventDefault();
            // console.log(form.checkValidity());
            if (form.checkValidity() === false) {
              event.preventDefault();
              event.stopPropagation();
              form.classList.add('was-validated');
            } else if (form.checkValidity() === true) {
              matchVallidator(formEmail, formConfirmEmail, event, invalidEmail, 'Email');
              matchVallidator(
                formPassword,
                formConfirmPassword,
                event,
                invalidPassword,
                'Password'
              );
            }
          },
          false
        );
      });
    },
    false
  );
})();
//for Password and Email-matching the two inputs
function matchVallidator(input1, input2, e, errorMessage, type) {
  if (input1.value !== input2.value) {
    e.preventDefault();
    errorMessage.style.display = 'block';
    errorMessage.textContent = `Both ${type} Inputs Must Be Matched!`;
  } else if (input1.value === input2.value) {
    errorMessage.style.display = 'none';
  }
}
//DISPLAY MODAL---
setAttributes(submitBtn, {
  'data-bs-toggle': 'modal',
  'data-bs-target': '#registerlogin',
});
