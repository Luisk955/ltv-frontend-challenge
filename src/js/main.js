const getToApi =  (pEmail) =>{
	const url = `https://ltv-data-api.herokuapp.com/api/v1/records.json?email=${pEmail}`;
	const resp =  fetch(url)
	.then(response => response.json())
	.then(data => {
		if( data != []){
			localStorage.setItem('searchResult', JSON.stringify(data));
		}
	})
}

document.querySelector('#btnSubmitSearch').addEventListener('click', (e)=>{
	e.preventDefault();
	let email = document.querySelector('#txtEmailAddress').value;
	getToApi(email);
});