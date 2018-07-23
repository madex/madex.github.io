function changeMusicTitleRandom(id) {
    if (id > 5)
        return;
    var x = Math.floor((Math.random() * (6-id)) + id);
    var ele1 = document.getElementById('mr'+id);
    var ele2 = document.getElementById('mr'+x);
    var help = ele1.innerHTML;
    ele1.innerHTML = ele2.innerHTML;
    ele2.innerHTML = help;
}    
changeMusicTitleRandom(1);
changeMusicTitleRandom(2);
changeMusicTitleRandom(3);
changeMusicTitleRandom(4);