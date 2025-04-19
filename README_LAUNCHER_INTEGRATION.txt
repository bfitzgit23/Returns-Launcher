
Integration Notes - Skip Intro

1. 'scripts/preload.js' now supports skipping intro via localStorage.
2. Add a button in your HTML:
   <button onclick="skipAndStart()">Skip Intro</button>

3. Include this in your HTML <script>:
   function skipAndStart() {
     window.huntedAPI.skipIntro();
     location.href = 'main_menu.html'; // or wherever the launcher should go
   }

4. Add logic to check window.huntedAPI.shouldSkipIntro() on launch.
