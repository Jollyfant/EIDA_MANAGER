const MINIMUM_ITEMS_PER_PAGE = 30;
const MAXIMUM_NUMBER_PAGES = 10;

var Table = function(options) {

  /* class Table
   * Returns table with content including
   * search & pagination functionality
   */

  this.header = options.header;
  this.body = options.body;
  this.search = options.search && this.body.length !== 0;

  // Generate the HTML for this table
  var content = new Array();
  if(this.search) {
    content = content.concat([ 
      "<div class='input-group'>",
      "  <span class='input-group-addon'><span class='fa fa-search' style='float: left;'></span> Search</span>",
      "  <input class='form-control' id='" + options.id + "-search" + "'/>",
      "</div>",
    ])
  }

  content.push("<div id='" + options.id + "-content" + "'></div>")

  document.getElementById(options.id).innerHTML = content.join("\n");

  // Get the search & content elements for this table
  if(this.search) {
    this.search = document.getElementById(options.id + "-search");
    this.search.addEventListener("input", this.draw.bind(this));
  }

  this.id = document.getElementById(options.id + "-content");

  // Dynamically set the number of items per page
  this.itemsPerPage = Math.max(
    MINIMUM_ITEMS_PER_PAGE,
    Math.ceil(this.body.length / MAXIMUM_NUMBER_PAGES)
  );

  // Keep track of the active page through pagination
  this.activeIndex = 0;

  // Draw the initial table
  this.draw();

}

Table.prototype.draw = function() {

  /* Table.draw
   * Redraws the table by creating the HTML
   */

  var filteredRows = this.body;

  if(this.search) {

    var searchTerm = this.search.value;
    var regex = new RegExp("^.*" + searchTerm + ".*$", "i");
    var filteredRows = this.body.filter(function(x) {
      for(var i = 0; i < x.length; i++) {
        if(String(x[i]).match(regex)) {
          return true;
        }
      }
    });

  }

  var pagination = this.generatePagination(filteredRows);

  this.id.innerHTML = [
    "<table class='table table-sm table-striped'>",
    this.generateTableHead(this.header),
    this.generateTableBody(filteredRows),
    "</table>",
    pagination
  ].join("\n");

  // Add listeners to all the page buttons
  Array.from(this.id.getElementsByClassName("page-item")).forEach(function(x) {
    x.addEventListener("click", this.setActiveIndex.bind(this, x));
  }.bind(this));

}

Table.prototype.generatePaginationList = function(list) {

  /* Table.generatePaginationList
   * Generates all pagination buttons
   */

  // No results (1 page)
  if(list.length === 0) {
    return this.paginationItem(0)
  }

  if(this.activeIndex * this.itemsPerPage > list.length) {
    this.activeIndex = Math.floor(list.length / this.itemsPerPage);
  }

  // Create the number of pages
  return list.filter(function(_, i) {
    return i % this.itemsPerPage === 0
  }.bind(this)).map(function(_, i) {
    return this.paginationItem(i);
  }.bind(this)).join("\n");

}

Table.prototype.paginationItem = function(index) {

  /* Table.paginationItem
   * Returns HTML representation of a pagination button
   */

  return "<li class='page-item " + (index === this.activeIndex ? "active" : "") + "'><span class='page-link'>" + (index + 1) + "</span></li>";

}

Table.prototype.setActiveIndex = function(context) {

  /* Table.setActiveIndex
   * Updates the table on click
   */

  var children = context.children[0];
  var maxIndex = Math.floor(this.body.length / this.itemsPerPage);

  switch(children.innerHTML) {
    case "Next":
      if(this.activeIndex === maxIndex) return;
      this.activeIndex++;
      break;
    case "Previous":
      if(this.activeIndex === 0) return;
      this.activeIndex--;
      break;
    default:
      this.activeIndex = Number(children.innerHTML) - 1;
      break;
  }

  // Clamp the active index between 0 and max pages
  this.activeIndex = Math.max(Math.min(maxIndex, this.activeIndex), 0);

  // Redraw
  this.draw();

}

Table.prototype.generatePagination = function(list) {

  /* function generatePagination
   * Generates the pagination for the active table
   */

  if(list.length < MINIMUM_ITEMS_PER_PAGE) {
    return "";
  }

  if(this.activeIndex * this.itemsPerPage > list.length) {
    this.activeIndex = Math.floor(list.length / this.itemsPerPage);
  }

  return [
   "<nav aria-label='Page navigation example'>",
     "<ul class='pagination'>",
       "<li class='page-item'><span class='page-link'>Previous</span></li>",
       this.generatePaginationList(list),
       "<li class='page-item'><span class='page-link'>Next</span></li>",
     "</ul>",
   "</nav>"
  ].join("\n");

}

Table.prototype.generateTableHead = function(header) {

  return [
    "  <thead>",
    "    <tr>",
    this.generateTableHeadContent(header),
    "    </tr>",
    "  </thead>"
  ].join("\n");

}

Table.prototype.generateTableBodyContent = function(body) {

  /* function generateTableBodyContent
   * 
   */
  const startSlice = this.itemsPerPage * this.activeIndex;
  const endSlice = startSlice + this.itemsPerPage;

  // Slice the data from memory to what is visible & unfiltered
  return body.slice(startSlice, endSlice).map(function(x) {
    return "<tr>" + this.generateTableRowContent(x) + "</tr>"
  }.bind(this)).join("\n");

}

Table.prototype.generateTableHeadContent = function(header) {
  return header.map(AddTagTH).join("\n");
}


Table.prototype.generateTableBody = function(body) {

  return [
    "  <tbody>",
    this.generateTableBodyContent(body),
    "  </tbody>"
  ].join("\n");

}

function AddTag(tag, x) {
  return "<" + tag + ">" + x + "</" + tag + ">";
}

function AddTagTD(x) {
  return AddTag("td", x);
}

function AddTagTH(x) {
  return AddTag("th", x);
}

Table.prototype.generateTableRowContent = function(row) {

  /* function generateTableRowContent
   * Generates single row content for a table
   */

  return row.map(AddTagTD).join("\n");

}
