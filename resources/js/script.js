let waypoints = [];
let splinePoints = [];
let ctx;
let ctxBackground;
let image;
let imageFlipped;
let wto;
let change = "propertychange change click keyup input paste";
let animating = false;

const fieldWidth = 886 * 0.0254; // inches
const fieldHeight = 360 * 0.0254; // inches
const xOffset = 120 * 0.0254;
const yOffset = 180 * 0.0254;
const width = 1604; //pixels
const height = 651; //pixels

const robotWidth = 28 * 0.0254; // inches
const robotHeight = 33 * 0.0254; // inches

const waypointRadius = 7;
const splineWidth = 2;

const kEps = 1E-9;
const pi = Math.PI;

class Translation2d {
	constructor(x, y) {
		this.x = x;
		this.y = y;
	}

	norm() {
        return Math.hypot(this.x, this.y);
    }

    norm2() {
        return this.x * this.x + this.y * this.y;
    }

    translateBy(other) {
        return new Translation2d(this.x + other.x, this.y + other.y);
    }

    rotateBy(rotation) {
        return new Translation2d(this.x * rotation.cos - this.y * rotation.sin, this.x * rotation.sin + this.y * rotation.cos);
    }

    direction() {
        return new Rotation2d(this.x, this.y, true);
    }

    inverse() {
		return new Translation2d(-this.x, -this.y);
    }

    interpolate(other, x) {
        if (x <= 0) {
            return new Translation2d(this.x, this.y);
        } else if (x >= 1) {
            return new Translation2d(other.x, other.y);
        }
        return this.extrapolate(other, x);
    }

    extrapolate(other, x) {
        return new Translation2d(x * (other.x - this.x) + this.x, x * (other.y - this.y) + this.y);
    }

	scale(s) {
		return new Translation2d(this.x * s, this.y * s);
    }

    static dot(a, b) {
		return a.x * b.x + a.y * b.y;
    }

    static getAngle(a, b) {
        let cos_angle = this.dot(a, b) / (a.norm() * b.norm());
        if (Double.isNaN(cos_angle)) {
            return new Rotation2d(1, 0, false);
        }

        return Rotation2d.fromRadians(Math.acos(Math.min(1.0, Math.max(cos_angle, -1.0))));
    }

    static cross(a, b) {
        return a.x * b.y - a.y * b.x;
    }

    distance(other) {
        return this.inverse().translateBy(other).norm();
    }

	draw(color, radius) {
		color = color || "#2CFF2C";
		ctx.beginPath();
		ctx.arc(this.drawX, this.drawY, radius, 0, 2 * Math.PI, false);
		ctx.fillStyle = color;
		ctx.strokeStyle = color;
		ctx.fill();
		ctx.lineWidth = 0;
		ctx.stroke();
	}

	get drawX() {
		return (this.x + xOffset) * (width / fieldWidth);
	}

	get drawY() {
		return height - (this.y + yOffset) * (height / fieldHeight);
	}
}

class Rotation2d {
	constructor(x, y, normalize) {
        this.cos = x;
        this.sin = y;
        this.normalize = normalize;
        if (normalize) {
            this.normalizeFunc();
        }
    }

    static fromRadians(angle_radians) {
        return new Rotation2d(Math.cos(angle_radians), Math.sin(angle_radians), false);
    }

    static fromDegrees(angle_degrees) {
        return this.fromRadians(d2r(angle_degrees));
    }

    normalizeFunc() {
        let magnitude = Math.hypot(this.cos, this.sin);
        if (magnitude > kEps) {
            this.cos /= magnitude;
            this.sin /= magnitude;
        } else {
            this.sin = 0;
            this.cos = 1;
        }
    }

    tan() {
        if (Math.abs(this.cos) < kEps) {
            if (this.sin >= 0.0) {
                return Number.POSITIVE_INFINITY;
            } else {
                return Number.NEGATIVE_INFINITY;
            }
        }
        return this.sin / this.cos;
    }

    getRadians() {
        return Math.atan2(this.sin, this.cos);
    }

    getDegrees() {
        return r2d(this.getRadians());
    }

    rotateBy(other) {
        return new Rotation2d(this.cos * other.cos - this.sin * other.sin,
                this.cos * other.sin + this.sin * other.cos, true);
    }

    normal() {
        return new Rotation2d(-this.sin, this.cos, false);
    }

    inverse() {
        return new Rotation2d(this.cos, -this.sin, false);
    }

    interpolate(other, x) {
        if (x <= 0) {
            return new Rotation2d(this.cos, this.sin, this.normalize);
        } else if (x >= 1) {
            return new Rotation2d(other.cos, other.sin, other.normalize);
        }
        let angle_diff = this.inverse().rotateBy(other).getRadians();
        return this.rotateBy(Rotation2d.fromRadians(angle_diff * x));
    }

    distance(other) {
        return this.inverse().rotateBy(other).getRadians();
    }
}

class Pose2d {
	constructor(translation, rotation, comment) {
		this.translation = translation;
		this.rotation = rotation;
        this.comment = comment || "";
    }

	static exp(delta) {
        let sin_theta = Math.sin(delta.dtheta);
        let cos_theta = Math.cos(delta.dtheta);
        let s, c;

        if (Math.abs(delta.dtheta) < kEps) {
            s = 1.0 - 1.0 / 6.0 * delta.dtheta * delta.dtheta;
            c = .5 * delta.dtheta;
        } else {
            s = sin_theta / delta.dtheta;
            c = (1.0 - cos_theta) / delta.dtheta;
        }

        return new Pose2d(new Translation2d(delta.dx * s - delta.dy * c, delta.dx * c + delta.dy * s),
                new Rotation2d(cos_theta, sin_theta, false));
    }

    static log(transform) {
        let dtheta = transform.getRotation().getRadians();
        let half_dtheta = 0.5 * dtheta;
        let cos_minus_one = transform.getRotation().cos() - 1.0;
        let halftheta_by_tan_of_halfdtheta;
        if (Math.abs(cos_minus_one) < kEps) {
            halftheta_by_tan_of_halfdtheta = 1.0 - 1.0 / 12.0 * dtheta * dtheta;
        } else {
            halftheta_by_tan_of_halfdtheta = -(half_dtheta * transform.getRotation().sin()) / cos_minus_one;
        }
        let translation_part = transform.getTranslation()
                .rotateBy(new Rotation2d(halftheta_by_tan_of_halfdtheta, -half_dtheta, false));
        return new Twist2d(translation_part.x(), translation_part.y(), dtheta);
    }

    get getTranslation() {
        return this.translation;
    }

    get getRotation() {
        return this.rotation;
    }

    transformBy(other) {
        return new Pose2d(this.translation.translateBy(other.translation.rotateBy(this.rotation)),
                this.rotation.rotateBy(other.rotation));
    }

    inverse() {
        let rotation_inverted = this.rotation.inverse();
        return new Pose2d(this.translation.inverse().rotateBy(rotation_inverted), rotation_inverted);
    }

    normal() {
        return new Pose2d(this.translation, this.rotation.normal());
    }

    interpolate(other, x) {
        if (x <= 0) {
            return new Pose2d(this.translation, this.rotation, this.comment);
        } else if (x >= 1) {
            return new Pose2d(other.translation, other.rotation, other.comment);
        }
        let twist = Pose2d.log(this.inverse().transformBy(other));
        return this.transformBy(Pose2d.exp(twist.scaled(x)));
    }

    distance(other) {
        return Pose2d.log(this.inverse().transformBy(other)).norm();
    }

    heading(other) {
	    return Math.atan2(this.translation.y - other.translation.y, this.translation.x - other.translation.x);
    }

    draw(drawHeading, radius) {
		this.translation.draw(null, radius);

		if (!drawHeading) {
		    return;
        }

        let x = this.translation.drawX;
        let y = this.translation.drawY;

		ctx.beginPath();
		ctx.moveTo(x, y);
		ctx.lineTo(x + 25 * Math.cos(-this.rotation.getRadians()), y + 25 * Math.sin(-this.rotation.getRadians()));
		ctx.lineWidth = 3;
		ctx.stroke();
        ctx.closePath();
	}

	toString() {
		return "new Pose2d(new Translation2d(" + this.translation.x + ", " + this.translation.y + "), new Rotation2d(" + this.rotation.cos + ", " + this.rotation.sin + ", " + this.rotation.normalize + "))";
	}

    transform(other) {
        other.position.rotate(this.rotation);
        this.translation.translate(other.translation);
        this.rotation.rotate(other.rotation);
    }
}

function d2r(d) {
    return d * (Math.PI / 180);
}

function r2d(r) {
    return r * (180 / Math.PI);
}

function fillRobot(position, heading, color) {
    let previous = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = "destination-over";

    let translation = position.translation;

    ctx.translate(translation.drawX, translation.drawY);
    ctx.rotate(-heading);

    let w = robotWidth * (width / fieldWidth);
    let h = robotHeight * (height / fieldHeight);
    ctx.fillStyle = color || "rgba(0, 0, 0, 0)";
    ctx.fillRect(-h / 2, -w / 2, h, w);

    ctx.rotate(heading);
    ctx.translate(-translation.drawX, -translation.drawY);

    ctx.globalCompositeOperation = previous;
}

let r = Math.sqrt(Math.pow(robotWidth, 2) + Math.pow(robotHeight, 2)) / 2;
let t = Math.atan2(robotHeight, robotWidth);

function drawRobot(position, heading) {
    let h = heading;
    let angles = [h + (pi / 2) + t, h - (pi / 2) + t, h + (pi / 2) - t, h - (pi / 2) - t];

    let points = [];

    angles.forEach(function(angle) {
        let point = new Translation2d(position.translation.x + (r * Math.cos(angle)),
            position.translation.y + (r * Math.sin(angle)));
        points.push(point);
        point.draw(Math.abs(angle - heading) < pi / 2 ? "#00AAFF" : "#0066FF", splineWidth);
    });
}

function init() {
    console.log("wat");
    let field = $('#field');
    let background = $('#background');
    let canvases = $('#canvases');
    let widthString = (width / 1.5) + "px";
    let heightString = (height / 1.5) + "px";

	field.css("width", widthString);
    field.css("height", heightString);
    background.css("width", widthString);
    background.css("height", heightString);
    canvases.css("width", widthString);
    canvases.css("height", heightString);

	ctx = document.getElementById('field').getContext('2d');
	ctx.canvas.width = width;
	ctx.canvas.height = height;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#FF0000";

    ctxBackground = document.getElementById('background').getContext('2d');
    ctxBackground.canvas.width = width;
    ctxBackground.canvas.height = height;
    ctx.clearRect(0, 0, width, height);

	image = new Image();
	image.src = 'resources/img/field.png';
	image.onload = function() {
		ctxBackground.drawImage(image, 0, 0, width, height);
		update();
	};
	imageFlipped = new Image();
	imageFlipped.src = 'resources/img/fieldFlipped.png';
    rebind();
}

function clear() {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#FF0000";

	ctxBackground.clearRect(0, 0, width, height);
    ctxBackground.fillStyle = "#FF0000";
    ctxBackground.drawImage(flipped ? imageFlipped : image, 0, 0, width, height);
}

function rebind() {
    let input = $('input');
    input.unbind(change);
    input.bind(change, function() {
        clearTimeout(wto);
        wto = setTimeout(function() {
            update();
        }, 500);
    });
}

function addPoint() {
	let prev;
	if (waypoints.length > 0) prev = waypoints[waypoints.length - 1].translation;
	else prev = new Translation2d(50, 50);
	$(document.getElementById("autopoints")).append("<tr>" + "<td class='drag-handler'></td>"
        + "<td class='x'><input type='number' value='" + (prev.x + 1) + "'></td>"
        + "<td class='y'><input type='number' value='" + (prev.y + 1) + "'></td>"
        + "<td class='heading'><input type='number' value='0'></td>"
        + "<td class='comments'><input type='search' placeholder='Comments'></td>"
        + "<td class='enabled'><input type='checkbox' checked></td>"
        + "<td class='backwards'><input type='checkbox' unchecked></td>"
        + "<td class='delete'><button onclick='$(this).parent().parent().remove();update()'>&times;</button></td></tr>");
	update();
	rebind();
}

function draw(style) {
    clear();
    drawWaypoints();

    switch (style) {
        // waypoints only
        case 1:
            break;
        // all
        case 2:
            drawSplines(true);
            drawSplines(false);
            break;
        case 3:
            animate();
            break;
    }
}

function update() {
    if (animating) {
        return;
    }

	waypoints = [];
    i = 0;
    splinePoints = [];
	$(document.getElementById("autopoints")).find("tbody>tr").each(function() {
		let x = parseFloat($($($(this).children()).children()[0]).val());
		let y = parseFloat($($($(this).children()).children()[1]).val());
		let heading = parseFloat($($($(this).children()).children()[2]).val());
		if (isNaN(heading)) {
			heading = 0;
        }
		let comment = ($($($(this).children()).children()[3]).val());
        let enabled = ($($($(this).children()).children()[4]).prop('checked'));
        let backwards = ($($($(this).children()).children()[5]).prop('checked'));
		if (enabled) {
            waypoints.push(new Pose2d(new Translation2d(x, y), Rotation2d.fromDegrees(heading), comment));
            if (i > 0) {
                let points = JSON.parse(Module.gen_spline(prev_x, prev_y, prev_heading, x, y, heading, backwards)).points;

                for (let i in points) {
                    let point = points[i];
                    if (i % 4 == 0) {
                        splinePoints.push(new Pose2d(new Translation2d(point.x, point.y), Rotation2d.fromRadians(point.rotation)));
                    }
                }
            }
        }
        prev_x = x;
        prev_y = y;
        prev_heading = heading;
        i+=1;
    });

    draw(1);
    draw(2);

}

let flipped = false;
function flipField() {
	flipped = !flipped;
	ctx.drawImage(flipped ? imageFlipped : image, 0, 0, width, height);
	update();
}

function drawWaypoints() {
	waypoints.forEach(function(waypoint) {
        waypoint.draw(true, waypointRadius);
        drawRobot(waypoint, waypoint.rotation.getRadians());
    });
}

let animation;

function animate() {
    drawSplines(false, true);
}

function drawSplines(fill, animate) {
    animate = animate || false;
    let i = 0;

    if (animate) {
        clearInterval(animation);

        animation = setInterval(function() {
            if (i === splinePoints.length) {
                animating = false;
                clearInterval(animation);
                return;
            }

            animating = true;

            let splinePoint = splinePoints[i];
            let hue = Math.round(180 * (i++ / splinePoints.length));

            let previous = ctx.globalCompositeOperation;
            fillRobot(splinePoint, splinePoint.rotation.getRadians(), 'hsla(' + hue + ', 100%, 50%, 0.025)');
            ctx.globalCompositeOperation = "source-over";
            drawRobot(splinePoint, splinePoint.rotation.getRadians());
            splinePoint.draw(false, splineWidth);
            ctx.globalCompositeOperation = previous;
        }, 25);
    } else {
        splinePoints.forEach(function(splinePoint) {
            splinePoint.draw(false, splineWidth);

            if (fill) {
                let hue = Math.round(180 * (i++ / splinePoints.length));
                fillRobot(splinePoint, splinePoint.rotation.getRadians(), 'hsla(' + hue + ', 100%, 50%, 0.025)');
            } else {
                drawRobot(splinePoint, splinePoint.rotation.getRadians());
            }
        });
    }
}

function download(table, auto_name) {
  var text = "";

  for (var i = 0, row; row = table.rows[i]; i++) {
    for (var j = 0, cell; cell = row.cells[j]; j++) {
      if (cell != row.cells[0] && cell != row.cells[row.cells.length - 1]) {
        if (cell.tagName != "TD") {
          text += cell.innerHTML;
        } else if (cell.firstChild.type == "checkbox") {
          text += cell.firstChild.checked;
        } else {
          text += cell.firstChild.value;
        }
        if (cell != row.cells[row.cells.length - 2]) {
          text += ","
        }
      }
    }
    text += "\n";
  }

  var element = document.createElement('a');
  element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
  element.setAttribute('download', auto_name + ".csv");
  element.style.display = 'none';
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
}

function resetTable() {
	var table = document.getElementById("autopoints");
	var rowCount = table.rows.length;
	for (var i=0; i < rowCount - 1; i++) {
			table.deleteRow(1);
	}
}

function extract() {
	resetTable();
	var table = document.getElementById("hiddenTable").firstChild;
	var current_row = [];
	for (var i = 1, row; row = table.rows[i]; i++) {
		for (var j = 0, cell; cell = row.cells[j]; j++) {
			current_row.push(cell.innerHTML);
		}

		$(document.getElementById("autopoints")).append("<tr>" + "<td class='drag-handler'></td>"
				+ "<td class='x'><input type='number' value='" + current_row[0] + "'></td>"
				+ "<td class='y'><input type='number' value='" + current_row[1] + "'></td>"
				+ "<td class='heading'><input type='number' value='" + current_row[2] + "'></td>"
				+ "<td class='comments'><input type='search' value='" + current_row[3] + "' placeholder='Comments'></td>"
				+ "<td class='enabled'><input type='checkbox'" + (current_row[4] == "true" ? "checked" : "") + " ></td>"
				+ "<td class='backwards'><input type='checkbox'" + (current_row[5] == "true" ? "checked" : "") + "></td>"
				+ "<td class='delete'><button onclick='$(this).parent().parent().remove();update()'>&times;</button></td></tr>");
		current_row = [];

  }
	update();
	rebind();
}

function upload() {
  var fileUpload = document.getElementById("fileid");
  var regex = /^([a-zA-Z0-9\s_\\.\-:])+(.csv|.txt)$/;
  if (regex.test(fileUpload.value.toLowerCase())) {
      if (typeof (FileReader) != "undefined") {
          var reader = new FileReader();
          reader.onload = function (e) {
              var table = document.createElement("table");
              var rows = e.target.result.split("\n");
              for (var i = 0; i < rows.length; i++) {
                  var cells = rows[i].split(",");
                  if (cells.length > 1) {
                      var row = table.insertRow(-1);
                      for (var j = 0; j < cells.length; j++) {
                          var cell = row.insertCell(-1);
                          cell.innerHTML = cells[j];
                      }
                  }
              }
              var dvCSV = document.getElementById("hiddenTable");
              dvCSV.innerHTML = "";
              dvCSV.appendChild(table);
          }
          reader.readAsText(fileUpload.files[0]);
					setTimeout(extract, 10);
      } else {
          alert("This browser does not support HTML5.");
      }
  } else {
      alert("Please upload a valid CSV file.");
  }
}

function capitalize(str) {
	str = str.toLowerCase().split(' ');
  for (var i = 0; i < str.length; i++) {
    str[i] = str[i].charAt(0).toUpperCase() + str[i].slice(1);
  }
  return str.join(' ');
}
function SetFieldPosition(){
	var text = "\t";
	var table = document.getElementById("autopoints");

	text += "SetFieldPosition(" + table.rows[1].cells[1].firstChild.value;
	text += ", " + table.rows[1].cells[2].firstChild.value;

	if (table.rows[1].cells[3].firstChild.value == 0) {
		text += ", 0"
	} else {
		 text += ", " + table.rows[1].cells[3].firstChild.value + " * deg);\n\n";
	}

	return text;
}

function withdraw() {
	var text = "";
	var table = document.getElementById("autopoints");
	var current_row = [];

	for (var i = 2, row; row = table.rows[i]; i++) {
		for (var j = 0, cell; cell = row.cells[j]; j++) {
			current_row.push(cell.firstChild);
		}

		if (current_row[4].value !== "") {
			text += "\t// " + current_row[4].value + "\n";
		}
		text += "\tStartDrivePath(" + current_row[1].value;
		text += ", " + current_row[2].value;
		if (current_row[3].value == 0) {
			text += ", 0"
		} else {
			 text += ", " + current_row[3].value + " * deg, ";
		}
		if (current_row[5].checked){
			text += ", -1";
		} else {
			text += ", 1";
		}
		text += ", kHighGear);\n";
		text += "\tWaitUntilDriveComplete();\n\n";
		current_row = [];
	}

	return text;
}


function makeHFile(auto_name) {
	var cap_auto_name = capitalize(document.getElementById("title").value.toString());
	var text = "";

	text += "#ifndef C2018_AUTONOMOUS_" + auto_name.toLocaleUpperCase().replace(/ /g,"_") + "_H_\n";
	text += "#define C2018_AUTONOMOUS_" + auto_name.toLocaleUpperCase().replace(/ /g,"_") + "_H_\n\n";

	text += "#include \"c2018/autonomous/autonomous_base.h\"\n";
	text += "#include \"muan/logging/logger.h\"\n\n";

	text += "namespace c2018 {\n";
	text += "namespace autonomous {\n\n";

	text += "class " + cap_auto_name.replace(/\s/g, '') + " : public c2018::autonomous::AutonomousBase {\n";
	text += " public:\n";
	text += "\tvoid " + cap_auto_name.replace(/\s/g, '') + "();\n";
	text += "};\n\n";

	text += "}  // namespace autonomous\n";
	text += "}  // namespace c2018\n\n";

	text += "#endif  // C2018_AUTONOMOUS_" + auto_name.toLocaleUpperCase().replace(/ /g,"_") + "_H_";

  var element = document.createElement('a');
  element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
  element.setAttribute('download', auto_name + ".h");
  element.style.display = 'none';
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
}

function makeCode(table, auto_name) {
	var cap_auto_name = capitalize(document.getElementById("title").value.toString());
	var text = "";

	text += "#include \"c2018/autonomous/" + auto_name.replace(/ /g,"_") + ".h\"\n\n";

	text += "namespace c2018 {\n";
	text += "namespace autonomous {\n\n";

	text += "using frc971::control_loops::drivetrain::Gear::kHighGear;\n";
	text += "using frc971::control_loops::drivetrain::Gear::kLowGear;\n";
	text += "using muan::units::deg;\n\n";

	text += "void " + cap_auto_name.replace(/\s/g, '') + "::" + cap_auto_name.replace(/\s/g, '') + "() {\n";

	text += SetFieldPosition();
	text += withdraw();

	text += "}\n\n";

	text += "}  // namespace autonomous\n";
	text += "}  // namespace c2018\n\n";


	var element = document.createElement('a');
	element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
	element.setAttribute('download', auto_name + ".cpp");
	element.style.display = 'none';
	document.body.appendChild(element);
	element.click();
	document.body.removeChild(element);
	makeHFile(document.getElementById("title").value.replace(/ /g,"_"));
}
