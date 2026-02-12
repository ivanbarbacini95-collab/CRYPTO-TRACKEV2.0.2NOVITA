let price = 10;
let ath = price;
let atl = price;
let polling = null;
let refreshMode = false;

/* MENU FIX DEFINITIVO */

const menuBtn = document.getElementById("menuBtn");
const sideMenu = document.getElementById("sideMenu");

let menuOpen = false;

function openMenu() {
  sideMenu.classList.add("open");
  menuOpen = true;
}

function closeMenu() {
  sideMenu.classList.remove("open");
  menuOpen = false;
}

function toggleMenu(e) {
  e.stopPropagation();
  menuOpen ? closeMenu() : openMenu();
}

menuBtn.addEventListener("click", toggleMenu);

document.addEventListener("click", (e) => {
  if (!menuOpen) return;
  if (!sideMenu.contains(e.target) && !menuBtn.contains(e.target)) {
    closeMenu();
  }
});

sideMenu.addEventListener("click", (e) => {
  const isMenuItem = e.target.closest(".menu-item");
  if (isMenuItem) closeMenu();
});

/* PRICE SIM */

function startPolling(){
  if(polling) return;
  polling = setInterval(updatePrice, 2000);
}

function stopPolling(){
  clearInterval(polling);
  polling = null;
}

function updatePrice(){
  if(refreshMode) return;
  const change = (Math.random() - 0.5);
  price += change;
  if(price > ath) ath = price;
  if(price < atl) atl = price;
  render();
}

function render(){
  const priceEl = document.getElementById("injPrice");
  priceEl.textContent = price.toFixed(2);
  priceEl.classList.remove("ath","atl");
  if(price === ath) priceEl.classList.add("ath");
  if(price === atl) priceEl.classList.add("atl");

  const bars = document.getElementById("bars");
  bars.innerHTML = "";
  for(let i=0;i<10;i++){
    const val = 20 + Math.random()*80;
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.style.height = val + "%";
    if(price === ath) bar.classList.add("ath");
    if(price === atl) bar.classList.add("atl");
    bars.appendChild(bar);
  }
}

document.getElementById("loadBtn").onclick = startPolling;

document.getElementById("refreshModeBtn").onclick = () => {
  refreshMode = !refreshMode;
  if(refreshMode) stopPolling();
  else startPolling();
};