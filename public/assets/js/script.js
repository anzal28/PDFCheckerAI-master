//Declaration
const navbar = document.querySelector('.navbar');
const scrollTop = document.querySelector('.scroll-top');

//fixed-nav
window.onscroll = () => {
  if (window.scrollY > 10) {
    navbar.classList.add('nav-active');
    scrollTop.classList.remove('opacity-0');
  } else {
    navbar.classList.remove('nav-active');
    scrollTop.classList.add('opacity-0');
  }
};
//typing animation
try {
  var typed = new Typed('#typed', {
    strings: ['Reference Checker', 'Document Validator'],
    backSpeed: 30,
    backDelay: 1300,
    typeSpeed: 30,
    loop: true,
  });
} catch (error) {
  console.log(error);
}

//Date
const dateText = document.querySelector('.text-date-footer');

const date = new Date().getFullYear();
dateText.innerHTML = ` Copyright © <strong>Company name</strong> ${date}. All rights reserved.`;
