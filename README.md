Smart Traffic Signal Management for Urban Congestion
B.Tech CSE | Design Thinking & Innovation Project

What is this project?
This project is a Smart Traffic Signal Management System that automatically controls traffic signals at a 4-way urban intersection. Instead of fixed timers, the system reads traffic density on each road and gives more green signal time to the busier roads. It is built completely using HTML, CSS, and JavaScript and runs directly in the browser.

Problem Statement
In most cities, traffic signals work on fixed timers. They give equal time to all directions even when one road is heavily congested and another is empty. This causes unnecessary delays, fuel waste, and frustration. A smarter system is needed that can adapt to real traffic conditions.

Proposed Solution
A smart signal system that reads the vehicle count on each road and dynamically adjusts the green signal duration. Busier roads get longer green time. Less busy roads get shorter green time. The system recalculates every cycle so it always reflects current traffic conditions.

How the Algorithm Works
Each road gets a score based on vehicle density, how long it has been waiting, and how many vehicles are queued. The road with the highest score gets the green signal first. Green duration is proportional to the score. No road is left waiting too long due to a built-in anti-starvation rule.

Features
Adaptive signal timing based on live traffic density. Four direction control — North, East, South, West. Traffic intensity controls for each direction. Emergency vehicle priority that clears the path instantly. Manual override to force any lane green. Scenario presets — Rush Hour, Night Traffic, Accident Mode. Live charts for traffic load, signal distribution, and efficiency. Animated road intersection with moving vehicles. Real-time event log showing every system decision.

Files
index.html — Page layout and structure
style.css — Dark theme dashboard styling
script.js — Signal logic, simulation, and charts

How to Run
Keep all 3 files in one folder and open index.html in any browser. No installation or internet required.

Technologies Used
HTML, CSS, JavaScript, Chart.js, Canvas API
B.Tech CSE — Design Thinking & Innovation | 2024-25