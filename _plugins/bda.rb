module Jekyll
  module BDAFilters
    def unique_authors(input)
      return input.map { | publication | publication["author"] }
        .flatten(1)
        .uniq
        .map { | author | author[0] + "_" + author[1] }
    end

    def publications_by(input, person)
      if person.nil?
        return input
      else
        return input.select{ | publication | publication["author"].select{ | author | (author[0] == person["name"][0] and author[1] == person["name"][1]) }.size > 0 }
      end
    end
  end
end

Liquid::Template.register_filter(Jekyll::BDAFilters)
