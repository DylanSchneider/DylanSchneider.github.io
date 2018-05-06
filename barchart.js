var margin = {
        top: 10,
        right: 10,
        bottom: 20,
        left: 30
    },
    width = 920 - margin.left - margin.right,
    height = 600 - margin.top - margin.bottom;

var y = d3.scale.linear()
    .range([height, 0]);

var x = d3.scale.ordinal()
    .rangeRoundBands([0, width], 0.6, 0.3);


var xAxisScale = d3.scale.linear()
    .range([0, width]);

var xAxis = d3.svg.axis()
	//.scale(xAxisScale)
    .orient("bottom")
    .tickFormat(d3.format("d"));

//var yAxisScale = d3.scale.linear()
//	.range(

var yAxis = d3.svg.axis()
    //.scale(y)
    .orient("left");


var svg = d3.select("#chart").append("svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom)
    .append("g")
    .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

d3.csv("pitchers.csv", function(error, data) {
	var filteredData = data.filter(function(d) {
		var name = localStorage.getItem('PlayerName');	
		if (d.Pitcher_ID == name){
			return d;
		}
	});
	console.log(filteredData);	
	let yearArr = filteredData.map(function(d) { return d.year; });
	if (yearArr.indexOf("2010") < 0){
		var new_json = {};
		new_json.Pitcher_ID = filteredData[0].Pitcher_ID;
		new_json.year = "2010";
		new_json.SaveRating = "0";
		new_json.made = "0";
		new_json.blown = "0";
		new_json.attempts = "0";
		filteredData.push(new_json);
	}
	if (yearArr.indexOf("2011") < 0){
        var new_json = {};
        new_json.Pitcher_ID = filteredData[0].Pitcher_ID;
        new_json.year = "2011";
        new_json.SaveRating = "0";
        new_json.made = "0";
        new_json.blown = "0";
        new_json.attempts = "0";
		filteredData.push(new_json);
    }
	if (yearArr.indexOf("2012") < 0){
        var new_json = {};
        new_json.Pitcher_ID = filteredData[0].Pitcher_ID;
        new_json.year = "2012";
        new_json.SaveRating = "0";
        new_json.made = "0";
        new_json.blown = "0";
        new_json.attempts = "0";
		filteredData.push(new_json);
    }
	if (yearArr.indexOf("2013") < 0){
        var new_json = {};
        new_json.Pitcher_ID = filteredData[0].Pitcher_ID;
        new_json.year = "2013";
        new_json.SaveRating = "0";
        new_json.made = "0";
        new_json.blown = "0";
        new_json.attempts = "0";
		filteredData.push(new_json);
    }
	filteredData.sort(function(a, b) {
		return parseInt(a.year) - parseInt(b.year);
	});
	
	xAxisScale.domain([d3.min(filteredData.map(function(d) { return d.year; })), (parseInt(d3.max(filteredData.map(function(d) { return d.year; })))+1).toString()])
    x.domain(filteredData.map(function(d) {
        return d.year;
    }));
	
	xAxis.scale(xAxisScale);
	
    y.domain(d3.extent(filteredData, function(d) {
        return d.SaveRating;
    }));
	yAxis.scale(y);
	console.log("H", y(height));
	console.log("0", y(0));
    svg.selectAll(".bar")
        .data(filteredData)
        .enter().append("rect")
        .attr("class", function(d) {

            if (d.SaveRating < 0){
                return "bar negative";
            } else {
                return "bar positive";
            }

        })
        .attr("data-yr", function(d){
            return d.year;
        })
        .attr("data-c", function(d){
            return d.SaveRating;
        })
        .attr("title", function(d){
            return d.Pitcher_ID;
        })
        .attr("y", function(d) {

            if (d.SaveRating > 0){
                return y(d.SaveRating);
            } else {
                return y(0);
            }

        })
        .attr("x", function(d) {
            return x(d.year);
        })
        .attr("width", x.rangeBand())
        .attr("height", function(d) {
            return Math.abs(y(d.SaveRating) - y(0));
        })
        .on("mouseover", function(d){
            // alert("Year: " + d.Year + ": " + d.Celsius + " Celsius");
            d3.select("#_yr")
                .text("Year: " + d.year);
            d3.select("#degrree")
                .text(d.SaveRating);
        });
    svg.append("g")
        .attr("class", "y axis")
        .call(yAxis);

    svg.append("g")
        .attr("class", "y axis")
        .append("text")
        .text("SR")
        .attr("transform", "translate(15, 40), rotate(-90)")

    svg.append("g")
        .attr("class", "X axis")
        .attr("transform", "translate(" + (margin.left+90) + "," + height + ")")
        .call(xAxis);

    svg.append("g")
        .attr("class", "x axis")
        .append("line")
        .attr("y1", y(0))
        .attr("y2", y(0))
        .attr("x2", width);

    svg.append("g")
        .attr("class", "infowin")
        .attr("transform", "translate(50, 5)")
        .append("text")
        .attr("id", "_yr");

    svg.append("g")
        .attr("class", "infowin")
        .attr("transform", "translate(110, 5)")
        .append("text")
        .attr("id","degrree");

});
