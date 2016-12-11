import { scaleLinear } from 'd3-scale'
import { line, curveCardinal } from 'd3-shape'
import { select } from 'd3-selection'
import { cycleDur, width, height } from './config'
import ConvergenceTimeseries from './visualization/convergenceTimeseries'
import mediator from './mediator'

const charts = {
	ConvergenceTimeseries
}

let updateSID = null, activeChart

const visDOM = select("#visualization")

const svg = visDOM.select("svg")

const svgWidth = svg.node().parentNode.getBoundingClientRect().width - 100
const svgHeight = Math.min(height / 6, 200)
svg.attr("width", svgWidth).attr("height", svgHeight)

Object.keys(charts).forEach(c => {
	charts[c] = new charts[c](svg, svgWidth, svgHeight, c)
})

mediator.subscribe("selectDataset", () => {
	window.clearInterval(updateSID)
	svg.attr("data-converged", false)
	
	charts[activeChart].clear()
	charts[activeChart].setup()

	updateSID = setInterval(() => {
		charts[activeChart].update()
	}, cycleDur)
})

mediator.subscribe("converged", () => {
	window.clearInterval(updateSID)
	charts[activeChart].converged()
	svg.attr("data-converged", true)
})

// dropdown stuff

const buildDropdown = () => {
	Object.keys(charts).forEach(d => {
		let element = document.createElement("div")
		element.classList.add("option")
		element.setAttribute("data-chart", d)
		element.textContent = d

		document.querySelector(".select-visualization .dropdown").appendChild(element)
	})
}

const selectOption = d => {
	activeChart = d
	document.querySelector(".select-visualization .current").textContent = d

	Array.prototype.forEach.call(document.querySelectorAll(".select-visualization .option"), el => {
		el.classList.remove("active")
	})

	document.querySelector(".select-visualization [data-chart=" + d + "]").classList.add("active")
}

buildDropdown()

selectOption('ConvergenceTimeseries')

let dropdownOpen = false

const toggleDropdown = () => {
	if(dropdownOpen) {
		closeDropdown()
	} else {
		openDropdown()
	}
}

const closeDropdown = () => {
	dropdownOpen = false
	document.querySelector(".select-visualization").classList.remove("open")
}

const openDropdown = () => {
	dropdownOpen = true
	document.querySelector(".select-visualization").classList.add("open")
}

document.addEventListener("click", e => {
	if(e.target.closest(".select-visualization")) {
		toggleDropdown()
		e.preventDefault()
		e.stopPropagation()
	} else {
		closeDropdown()
	}
})

// slider stuff

let sliderDown = false

const initialDiversity = 0.3
const sliderRect = document.querySelector("#edit-diversity .slider").getBoundingClientRect()
const sliderLeft = sliderRect.left
const sliderWidth = sliderRect.width

const circle = document.querySelector("#edit-diversity .circle")
const sliderLabel = document.querySelector("#edit-diversity .label .diversity")

document.addEventListener("mousedown", e => {
	if(e.target.classList.contains("circle")) {
		sliderDown = true
	}
})

document.addEventListener("mouseup", e => {
	sliderDown = false
})

const updateDiversity = left => {
	circle.style.left = left + 'px'
	mediator.publish("updateDiversity", left / sliderWidth)
	sliderLabel.textContent = (left / sliderWidth).toFixed(2)
}

document.addEventListener("mousemove", e => {
	if(!sliderDown) return

	const left = Math.max(0, Math.min(sliderWidth, e.clientX - sliderLeft))
	updateDiversity(left)
})

updateDiversity(initialDiversity * sliderWidth)
